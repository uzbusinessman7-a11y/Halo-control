import test from 'node:test';
import assert from 'node:assert/strict';
import { deployConfig, fallbackConfig, readSettings } from '../scripts/cloudflare-deploy.mjs';

const env = { HALO_WORKER_NAME: 'halo-control', HALO_D1_DATABASE_ID: '833efbd4-a206-4026-84d6-70b2e0ae7ae7', HALO_D1_DATABASE_NAME: 'halo-db' };

test('build o‘zgaruvchilari yetishmasa aniq xabar beriladi', () => {
  assert.throws(() => readSettings({}), /HALO_WORKER_NAME, HALO_D1_DATABASE_ID, HALO_D1_DATABASE_NAME/);
  assert.throws(() => readSettings({ ...env, HALO_D1_DATABASE_ID: 'abc' }), /noto'g'ri/);
  assert.throws(() => readSettings({ ...env, HALO_WORKER_NAME: 'Halo Control' }), /kichik harf/);
  assert.equal(readSettings(env).databaseName, 'halo-db');
});

test('ChatGPT Sites qiymatlari o‘z akkaunt qiymatlariga majburan almashtiriladi', () => {
  const generated = {
    name: 'site-creator', main: 'index.js', account_id: 'openai',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: 'site-creator-d1', database_id: '00000000-0000-4000-8000-000000000000' }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: 'site-creator-r2' }],
    assets: { directory: '../client', binding: 'ASSETS' },
  };
  const config = deployConfig(generated, readSettings(env));
  assert.equal(config.name, 'halo-control');
  assert.deepEqual(config.d1_databases, [{ binding: 'DB', database_name: 'halo-db', database_id: env.HALO_D1_DATABASE_ID }]);
  assert.equal(config.r2_buckets, undefined);
  assert.equal(config.vars.HALO_SELF_HOSTED, '1');
  assert.equal(config.account_id, undefined);
  assert.deepEqual(config.assets, generated.assets);
  assert.equal(generated.name, 'site-creator');
});

test('R2 nomi berilsa rasm ombori ulanadi', () => {
  const config = deployConfig({}, readSettings({ ...env, HALO_R2_BUCKET_NAME: 'halo-files' }));
  assert.deepEqual(config.r2_buckets, [{ binding: 'BUCKET', bucket_name: 'halo-files' }]);
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
});

test('zaxira sozlama tayyor build fayllarini qayta yig‘masdan yuklaydi', () => {
  const config = fallbackConfig('/x/dist/server', '/nonexistent/client');
  assert.equal(config.main, 'index.js');
  assert.equal(config.no_bundle, true);
  assert.equal(config.find_additional_modules, true);
  assert.equal(config.assets, undefined);
});
