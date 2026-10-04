/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { applyOwnerAuth, type OwnerAuthEnv } from "./owner-auth";
import { runScheduledJobs } from "../app/lib/scheduled-jobs";

interface Env extends OwnerAuthEnv {
  ASSETS: Fetcher;
  OPENAI_API_KEY?: string;
  HALO_AI_MODEL?: string;
  DB: D1Database;
  BUCKET: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

declare global {
  var __HALO_CONTROL_DB__: D1Database | undefined;
  var __HALO_CONTROL_BUCKET__: R2Bucket | undefined;
  var __HALO_SELF_HOSTED__: boolean | undefined;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    globalThis.__HALO_ASSISTANT_AI__ = { key: env.OPENAI_API_KEY || "", model: env.HALO_AI_MODEL || "gpt-4o-mini" };
    globalThis.__HALO_CONTROL_DB__ = env.DB;
    globalThis.__HALO_CONTROL_BUCKET__ = env.BUCKET;
    globalThis.__HALO_SELF_HOSTED__ = env.HALO_SELF_HOSTED === "1";
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    // O'z hosting rejimida rahbar kirishi shu yerda tekshiriladi (ChatGPT Sites'da hech narsa qilmaydi).
    const auth = await applyOwnerAuth(request, env);
    if ("response" in auth) {
      const page = new Response(auth.response.body, auth.response);
      page.headers.set("X-Content-Type-Options", "nosniff");
      page.headers.set("X-Frame-Options", "DENY");
      page.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      return page;
    }
    // Asosiy manzil yangi tizimni ochadi. Eski ko'rinish kerak bo'lsa: /?eski=1 yoki /xodim?eski=1.
    if (globalThis.__HALO_SELF_HOSTED__ && request.method === "GET" && !url.searchParams.has("eski")) {
      if (url.pathname === "/") return Response.redirect(new URL("/api/v2/bosh", url).toString(), 302);
      if (url.pathname === "/xodim") return Response.redirect(new URL("/api/v2/xodim", url).toString(), 302);
      // HALO HISOB oynasi (naqd/hisob-raqam, delivery, oshxona, chiqit). Eski ko'rinish: /hisob?eski=1.
      if (url.pathname === "/ornatish" || url.pathname === "/app" || url.pathname === "/install") return Response.redirect(new URL(`/api/v2/ornatish${url.search}`, url).toString(), 302);
      if (url.pathname === "/pos" || url.pathname === "/kassa" || url.pathname === "/hisob") return Response.redirect(new URL("/api/v2/pos", url).toString(), 302);
      // Monitor menyusi (televizor) — parolsiz ochiladi, faqat o'qiydi:
      //   /menu?screen=kebab | chicken | pitsa   (eski saytdagi "?screen=…" bilan bir xil)
      //   /tv/kebab                              (qisqa manzil)
      // Boshqa filial: &branch=<filial> yoki &b=<filial>.
      const tv = url.pathname.match(/^\/tv(?:\/([a-z0-9-]{1,24}))?\/?$/);
      if (tv || url.pathname === "/menu" || url.pathname === "/menu/") {
        const target = new URL("/api/v2/tv", url);
        const screen = tv?.[1] || url.searchParams.get("screen");
        if (screen) target.searchParams.set("screen", screen);
        const branch = url.searchParams.get("branch") || url.searchParams.get("b");
        if (branch) target.searchParams.set("b", branch);
        return Response.redirect(target.toString(), 302);
      }
    }
    const response = await handler.fetch(auth.request, env, ctx);
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("X-Frame-Options", "DENY");
    secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (url.pathname.startsWith("/api/")) {
      secured.headers.set("Cache-Control", "no-store");
    }
    return secured;
  },

  /** Cron: to'liq o'tishdan keyin kunlik Telegram hisobotlar (parallel rejimda hech narsa qilmaydi). */
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    globalThis.__HALO_CONTROL_DB__ = env.DB;
    globalThis.__HALO_CONTROL_BUCKET__ = env.BUCKET;
    globalThis.__HALO_SELF_HOSTED__ = env.HALO_SELF_HOSTED === "1";
    if (!globalThis.__HALO_SELF_HOSTED__) return;
    ctx.waitUntil(runScheduledJobs().then(() => undefined, () => undefined));
  },
};

export default worker;
