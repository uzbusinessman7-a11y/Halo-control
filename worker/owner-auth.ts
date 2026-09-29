/**
 * Rahbar kirishi — ChatGPT'siz (o'z Cloudflare akkauntida).
 *
 * Qanday ishlaydi:
 * - HALO_OWNER_EMAIL, HALO_OWNER_PASSWORD va HALO_AUTH_SECRET Cloudflare
 *   secretlari sifatida berilsa, "o'z hosting" rejimi yoqiladi.
 * - Har bir so'rovdan tashqaridan kelgan barcha `oai-authenticated-*`
 *   sarlavhalari o'chiriladi (hech kim o'zini rahbar deb soxtalashtira olmaydi).
 * - Rahbar /signin-with-chatgpt sahifasida email + parol bilan kiradi.
 *   To'g'ri bo'lsa, HMAC bilan imzolangan cookie beriladi.
 * - Imzo to'g'ri bo'lgan so'rovlarga ilova kutayotgan
 *   `oai-authenticated-user-email` sarlavhasi qo'shiladi. Shu sababli ilova
 *   kodining qolgan qismi o'zgartirilmaydi.
 * - Parol o'zgarsa, eski sessiyalar avtomatik bekor bo'ladi.
 *
 * Secretlar berilmasa (ChatGPT Sites), bu modul hech narsa qilmaydi.
 */

export interface OwnerAuthEnv {
  HALO_OWNER_EMAIL?: string;
  HALO_OWNER_PASSWORD?: string;
  HALO_AUTH_SECRET?: string;
}

type OwnerConfig = { email: string; password: string; secret: string };

export const SESSION_COOKIE = "halo_owner";
export const SIGN_IN_PATH = "/signin-with-chatgpt";
export const SIGN_OUT_PATH = "/signout-with-chatgpt";
const IDENTITY_HEADER_PREFIX = "oai-authenticated-";
const EMAIL_HEADER = "oai-authenticated-user-email";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 12;
const MIN_SECRET_LENGTH = 32;
const FAILED_LOGIN_DELAY_MS = 1500;

const encoder = new TextEncoder();

export type OwnerAuthMode =
  | { mode: "platform" }
  | { mode: "self-hosted"; config: OwnerConfig }
  | { mode: "misconfigured"; problem: string };

export function ownerAuthMode(env: OwnerAuthEnv): OwnerAuthMode {
  const email = String(env.HALO_OWNER_EMAIL || "").trim().toLowerCase();
  const password = String(env.HALO_OWNER_PASSWORD || "");
  const secret = String(env.HALO_AUTH_SECRET || "");
  if (!email && !password && !secret) return { mode: "platform" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { mode: "misconfigured", problem: "HALO_OWNER_EMAIL noto‘g‘ri yoki berilmagan." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { mode: "misconfigured", problem: `HALO_OWNER_PASSWORD kamida ${MIN_PASSWORD_LENGTH} belgi bo‘lishi kerak.` };
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return { mode: "misconfigured", problem: `HALO_AUTH_SECRET kamida ${MIN_SECRET_LENGTH} belgi bo‘lishi kerak.` };
  }
  return { mode: "self-hosted", config: { email, password, secret } };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/** Parol va secret ikkalasi ham imzo kalitiga kiradi: parol o'zgarsa, eski cookie ishlamaydi. */
function signingKey(config: OwnerConfig): string {
  return `${config.secret}\u0000${config.password}\u0000${config.email}`;
}

export async function createSessionValue(config: OwnerConfig, nowMs = Date.now()): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ e: config.email, x: Math.floor(nowMs / 1000) + SESSION_SECONDS })));
  const signature = base64url(await hmac(signingKey(config), payload));
  return `${payload}.${signature}`;
}

export async function verifySessionValue(config: OwnerConfig, value: string | null | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!value || value.length > 1000) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const given = fromBase64url(signature);
  if (!given) return false;
  const expected = await hmac(signingKey(config), payload);
  if (!constantTimeEqual(given, expected)) return false;
  const raw = fromBase64url(payload);
  if (!raw) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(raw)) as { e?: unknown; x?: unknown };
    return data.e === config.email && typeof data.x === "number" && data.x * 1000 > nowMs;
  } catch {
    return false;
  }
}

export async function credentialsMatch(config: OwnerConfig, email: string, password: string): Promise<boolean> {
  // Ikkala taqqoslash ham doim bajariladi va HMAC orqali — vaqt bo'yicha farq bermaydi.
  const key = config.secret;
  const [a, b, c, d] = await Promise.all([
    hmac(key, email.trim().toLowerCase()), hmac(key, config.email),
    hmac(key, password), hmac(key, config.password),
  ]);
  const emailOk = constantTimeEqual(a, b);
  const passwordOk = constantTimeEqual(c, d);
  return emailOk && passwordOk;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Faqat shu saytning ichki manzili; tashqi yoki "//" bilan boshlangan manzil rad etiladi. */
export function safeReturnPath(value: string | null | undefined): string {
  const path = String(value || "/");
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\") || /[\u0000-\u001f]/.test(path)) return "/";
  return path.slice(0, 500);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function cookieHeader(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function loginPage(returnTo: string, message = "", status = 200): Response {
  const html = `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>HALO Control — rahbar kirishi</title>
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--text:#16181d;--muted:#5d6470;--line:#d7dbe2;--accent:#0f766e;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#eef0f3;--muted:#a3a9b4;--line:#2c313a;--accent:#2dd4bf;--bad:#f97066}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{margin:0 0 4px;font-size:22px}p{margin:0 0 20px;color:var(--muted);font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font-size:16px}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer}
.err{margin:0 0 8px;padding:10px 12px;border-radius:10px;border:1px solid var(--bad);color:var(--bad);font-size:14px}
</style></head><body><main>
<h1>HALO Control</h1><p>Rahbar kirishi</p>
${message ? `<div class="err" role="alert">${escapeHtml(message)}</div>` : ""}
<form method="post" action="${SIGN_IN_PATH}">
<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required>
<label for="password">Parol</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Kirish</button>
</form></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Worker so'rovni ilovaga uzatishdan oldin chaqiradi.
 * `response` qaytsa — shu javob beriladi (kirish sahifasi, chiqish va h.k.).
 * Aks holda `request` — tozalangan (va rahbar bo'lsa, belgilangan) so'rov.
 */
export async function applyOwnerAuth(
  request: Request,
  env: OwnerAuthEnv,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ response: Response } | { request: Request }> {
  const auth = ownerAuthMode(env);
  if (auth.mode === "platform") return { request };

  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith(IDENTITY_HEADER_PREFIX)) headers.delete(name);
  }

  if (auth.mode === "misconfigured") {
    if (url.pathname === SIGN_IN_PATH) {
      return { response: loginPage("/", `Sozlama xatosi: ${auth.problem}`, 503) };
    }
    return { request: new Request(request, { headers }) };
  }

  const { config } = auth;

  if (url.pathname === SIGN_OUT_PATH) {
    return { response: new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": cookieHeader("", 0, secure), "Cache-Control": "no-store" } }) };
  }

  if (url.pathname === SIGN_IN_PATH) {
    if (request.method === "POST") {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return { response: loginPage("/", "So‘rov noto‘g‘ri.", 400) };
      }
      const returnTo = safeReturnPath(String(form.get("return_to") || "/"));
      const ok = await credentialsMatch(config, String(form.get("email") || "").slice(0, 200), String(form.get("password") || "").slice(0, 500));
      if (!ok) {
        await sleep(FAILED_LOGIN_DELAY_MS);
        return { response: loginPage(returnTo, "Email yoki parol noto‘g‘ri.", 401) };
      }
      const session = await createSessionValue(config);
      return { response: new Response(null, { status: 303, headers: { Location: returnTo, "Set-Cookie": cookieHeader(session, SESSION_SECONDS, secure), "Cache-Control": "no-store" } }) };
    }
    if (await verifySessionValue(config, readCookie(request, SESSION_COOKIE))) {
      return { response: new Response(null, { status: 303, headers: { Location: safeReturnPath(url.searchParams.get("return_to")), "Cache-Control": "no-store" } }) };
    }
    return { response: loginPage(safeReturnPath(url.searchParams.get("return_to"))) };
  }

  if (await verifySessionValue(config, readCookie(request, SESSION_COOKIE))) {
    headers.set(EMAIL_HEADER, config.email);
  }
  return { request: new Request(request, { headers }) };
}
