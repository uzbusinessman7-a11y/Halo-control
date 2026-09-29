import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOwnerAuth, createSessionValue, ownerAuthMode, safeReturnPath, verifySessionValue, SESSION_COOKIE,
} from '../worker/owner-auth.ts';

const env = {
  HALO_OWNER_EMAIL: 'Owner@Example.com',
  HALO_OWNER_PASSWORD: 'uzun-va-kuchli-parol-2026',
  HALO_AUTH_SECRET: 'x'.repeat(48),
};
const config = { email: 'owner@example.com', password: env.HALO_OWNER_PASSWORD, secret: env.HALO_AUTH_SECRET };
const noSleep = async () => {};
const site = 'https://halo.example.workers.dev';

async function login(email, password, returnTo = '/nazorat') {
  const body = new URLSearchParams({ email, password, return_to: returnTo });
  return applyOwnerAuth(new Request(`${site}/signin-with-chatgpt`, {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }), env, noSleep);
}

function sessionFrom(response) {
  const cookie = response.headers.get('set-cookie') || '';
  return cookie.split(';')[0].split('=').slice(1).join('=');
}

test('ChatGPT Sites rejimi: secretlar yo‘q bo‘lsa so‘rov umuman o‘zgarmaydi', async () => {
  const request = new Request(`${site}/api/state`, { headers: { 'oai-authenticated-user-email': 'owner@example.com' } });
  const result = await applyOwnerAuth(request, {}, noSleep);
  assert.equal(result.request, request);
  assert.equal(ownerAuthMode({}).mode, 'platform');
});

test('soxta rahbar sarlavhasi o‘chiriladi — begona odam o‘zini rahbar deb ko‘rsata olmaydi', async () => {
  const request = new Request(`${site}/api/backups?download=current`, {
    headers: { 'oai-authenticated-user-email': 'owner@example.com', 'OAI-Authenticated-User-Full-Name': 'Otabek' },
  });
  const result = await applyOwnerAuth(request, env, noSleep);
  assert.equal(result.request.headers.get('oai-authenticated-user-email'), null);
  assert.equal(result.request.headers.get('oai-authenticated-user-full-name'), null);
});

test('to‘g‘ri email va parol bilan kirish: imzolangan cookie va rahbar belgisi', async () => {
  const { response } = await login('  OWNER@example.com ', env.HALO_OWNER_PASSWORD);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/nazorat');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Secure/);
  const session = sessionFrom(response);
  const next = await applyOwnerAuth(new Request(`${site}/api/state`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } }), env, noSleep);
  assert.equal(next.request.headers.get('oai-authenticated-user-email'), 'owner@example.com');
});

test('noto‘g‘ri parol yoki email: kirish yo‘q, kechiktirish ishlaydi', async () => {
  let slept = 0;
  const body = new URLSearchParams({ email: 'owner@example.com', password: 'notogri-parol-123', return_to: '/' });
  const result = await applyOwnerAuth(new Request(`${site}/signin-with-chatgpt`, {
    method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }), env, async (ms) => { slept = ms; });
  assert.equal(result.response.status, 401);
  assert.equal(result.response.headers.get('set-cookie'), null);
  assert.ok(slept >= 1000);
  assert.equal((await login('begona@example.com', env.HALO_OWNER_PASSWORD)).response.status, 401);
});

test('buzilgan, muddati o‘tgan yoki boshqa kalit bilan imzolangan cookie qabul qilinmaydi', async () => {
  const valid = await createSessionValue(config);
  assert.equal(await verifySessionValue(config, valid), true);
  const [payload, signature] = valid.split('.');
  assert.equal(await verifySessionValue(config, `${payload}.${signature.slice(0, -2)}AA`), false);
  const forgedPayload = Buffer.from(JSON.stringify({ e: 'owner@example.com', x: 9999999999 })).toString('base64url');
  assert.equal(await verifySessionValue(config, `${forgedPayload}.${signature}`), false);
  const old = await createSessionValue(config, Date.now() - 31 * 24 * 3600 * 1000);
  assert.equal(await verifySessionValue(config, old), false);
  assert.equal(await verifySessionValue({ ...config, secret: 'y'.repeat(48) }, valid), false);
  for (const junk of ['', 'abc', 'a.b.c', '..', 'x'.repeat(2000)]) assert.equal(await verifySessionValue(config, junk), false);
});

test('parol o‘zgarsa, eski sessiyalar avtomatik bekor bo‘ladi', async () => {
  const session = await createSessionValue(config);
  assert.equal(await verifySessionValue({ ...config, password: 'yangi-kuchli-parol-2027' }, session), false);
});

test('chiqish cookie’ni o‘chiradi; qaytish manzili faqat sayt ichida', async () => {
  const { response } = await applyOwnerAuth(new Request(`${site}/signout-with-chatgpt`), env, noSleep);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/a\u0000b']) {
    assert.equal(safeReturnPath(bad), '/');
  }
  assert.equal(safeReturnPath('/hisob?sana=2026-09-29'), '/hisob?sana=2026-09-29');
  const { response: r } = await login('owner@example.com', env.HALO_OWNER_PASSWORD, 'https://evil.example');
  assert.equal(r.headers.get('location'), '/');
});

test('kirish sahifasi xavfsiz: qaytish manzili HTML ichida qochiriladi', async () => {
  const { response } = await applyOwnerAuth(new Request(`${site}/signin-with-chatgpt?return_to=%2F%22%3E%3Cscript%3E`), env, noSleep);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(!html.includes('"><script>'));
});

test('zaif sozlama rad etiladi va rahbar belgisi berilmaydi', async () => {
  for (const bad of [
    { ...env, HALO_OWNER_PASSWORD: 'qisqa' },
    { ...env, HALO_AUTH_SECRET: 'qisqa' },
    { ...env, HALO_OWNER_EMAIL: 'email-emas' },
    { HALO_OWNER_PASSWORD: env.HALO_OWNER_PASSWORD },
  ]) {
    assert.equal(ownerAuthMode(bad).mode, 'misconfigured');
    const result = await applyOwnerAuth(new Request(`${site}/api/state`, { headers: { 'oai-authenticated-user-email': 'owner@example.com' } }), bad, noSleep);
    assert.equal(result.request.headers.get('oai-authenticated-user-email'), null);
  }
});

test('xodim sahifalari va POST so‘rovlari tanasi bilan o‘zgarishsiz o‘tadi', async () => {
  const body = JSON.stringify({ pin: '1234' });
  const result = await applyOwnerAuth(new Request(`${site}/api/worker-auth`, {
    method: 'POST', body, headers: { 'content-type': 'application/json' },
  }), env, noSleep);
  assert.equal(result.request.method, 'POST');
  assert.equal(await result.request.text(), body);
  assert.equal(result.request.headers.get('oai-authenticated-user-email'), null);
});
