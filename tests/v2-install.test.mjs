import './helpers/ts-resolve.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const page = await import('../app/api/v2/ornatish/route.ts');
const xodim = await import('../app/api/v2/xodim/route.ts');

test('ilova manifestlari: har biri o‘z nomi, ikonkalari, start_url o‘z scope ichida', () => {
  const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'));
  const apps = { 'manifest.webmanifest': 'HALO Control', 'xodim-manifest.webmanifest': 'HALO Xodim', 'halo-hisob-manifest.webmanifest': 'HALO HISOB' };
  const ids = new Set();
  for (const [file, name] of Object.entries(apps)) {
    const m = read(file);
    assert.equal(m.name, name);
    assert.ok(m.start_url.startsWith(m.scope), `${file}: start_url scope ichida`);
    assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'Windows/Android uchun maskable ikonka');
    assert.ok(m.icons.some((i) => i.sizes === '192x192'));
    for (const icon of m.icons) assert.ok(fs.existsSync(new URL(`../public${icon.src}`, import.meta.url)), icon.src);
    ids.add(m.id);
    assert.equal(m.display, 'standalone');
  }
  assert.equal(ids.size, 3, 'uchta alohida ilova');
});

test('o‘rnatish sahifasi va sahifalar: manifest, Apple belgilari, service worker', async () => {
  globalThis.__HALO_SELF_HOSTED__ = true;
  const html = await (await page.GET(new Request('https://halo.example.workers.dev/api/v2/ornatish?app=xodim'))).text();
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /rel="manifest" href="\/xodim-manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/halo-xodim-180\.png"/);
  assert.match(html, /serviceWorker\.register\('\/sw\.js'\)/);
  for (const word of ['Bosh ekranga qo‘shish', 'Dock', 'Windows', 'Android']) assert.match(html, new RegExp(word));
  const x = await (await xodim.GET()).text();
  assert.match(x, /xodim-manifest\.webmanifest/);
});
