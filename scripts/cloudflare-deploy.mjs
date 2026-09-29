#!/usr/bin/env node
/**
 * HALO Control — o'z Cloudflare akkauntiga joylash.
 *
 * ChatGPT Sites deploy sozlamasini o'zi beradi. O'z akkauntda esa wrangler
 * sozlama faylini kutadi. Bu skript `npm run build` dan keyin:
 *   1. build yaratgan dist/server/wrangler.json ni topadi (bo'lmasa o'zi yozadi),
 *   2. worker nomi, D1 ID va HALO_SELF_HOSTED ni majburan to'g'rilaydi,
 *   3. D1 migratsiyalarini qo'llaydi,
 *   4. wrangler deploy qiladi.
 *
 * Talab qilinadigan build o'zgaruvchilari: HALO_WORKER_NAME, HALO_D1_DATABASE_ID,
 * HALO_D1_DATABASE_NAME. Ixtiyoriy: HALO_R2_BUCKET_NAME.
 * Qarang: docs/CLOUDFLARE_KOCHISH.md
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function readSettings(env) {
  const settings = {
    workerName: String(env.HALO_WORKER_NAME || "").trim(),
    databaseId: String(env.HALO_D1_DATABASE_ID || "").trim(),
    databaseName: String(env.HALO_D1_DATABASE_NAME || "").trim(),
    bucketName: String(env.HALO_R2_BUCKET_NAME || "").trim(),
  };
  const missing = ["HALO_WORKER_NAME", "HALO_D1_DATABASE_ID", "HALO_D1_DATABASE_NAME"]
    .filter((name) => !String(env[name] || "").trim());
  if (missing.length) {
    throw new Error(`Build o'zgaruvchilari yetishmaydi: ${missing.join(", ")}. Cloudflare → Settings → Builds → Variables and secrets.`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settings.databaseId)) {
    throw new Error("HALO_D1_DATABASE_ID noto'g'ri ko'rinishda (masalan 833efbd4-a206-...).");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(settings.workerName)) {
    throw new Error("HALO_WORKER_NAME faqat kichik harf, raqam va '-' dan iborat bo'lsin.");
  }
  return settings;
}

function d1Binding(settings, migrationsDir) {
  return {
    binding: "DB",
    database_name: settings.databaseName,
    database_id: settings.databaseId,
    ...(migrationsDir ? { migrations_dir: migrationsDir } : {}),
  };
}

/** Build yaratgan sozlamani (yoki zaxira sozlamani) o'z akkaunt qiymatlari bilan majburan to'g'rilaydi. */
export function deployConfig(generated, settings) {
  const config = { ...(generated || {}) };
  config.name = settings.workerName;
  config.compatibility_date = config.compatibility_date || "2026-06-01";
  config.compatibility_flags = [...new Set([...(config.compatibility_flags || []), "nodejs_compat"])];
  const otherD1 = (config.d1_databases || []).filter((database) => database.binding !== "DB");
  config.d1_databases = [...otherD1, d1Binding(settings)];
  const otherR2 = (config.r2_buckets || []).filter((bucket) => bucket.binding !== "BUCKET");
  config.r2_buckets = settings.bucketName ? [...otherR2, { binding: "BUCKET", bucket_name: settings.bucketName }] : otherR2;
  if (!config.r2_buckets.length) delete config.r2_buckets;
  config.vars = { ...(config.vars || {}), HALO_SELF_HOSTED: "1" };
  // ChatGPT Sites'ga xos maydonlar o'z akkauntda kerak emas.
  delete config.account_id;
  return config;
}

export function fallbackConfig(serverDir, clientDir) {
  const config = {
    main: "index.js",
    no_bundle: true,
    find_additional_modules: true,
    base_dir: ".",
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"], fallthrough: true }],
  };
  if (clientDir && existsSync(clientDir)) {
    config.assets = { directory: relative(serverDir, clientDir) || ".", binding: "ASSETS" };
  }
  return config;
}

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} muvaffaqiyatsiz tugadi (kod ${result.status}).`);
}

function listDir(path) {
  try {
    return readdirSync(path).join(", ");
  } catch {
    return "(yo'q)";
  }
}

export function main(root = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const settings = readSettings(process.env);
  const dist = join(root, "dist");
  const serverDir = join(dist, "server");
  const clientDir = join(dist, "client");
  if (!existsSync(join(serverDir, "index.js"))) {
    throw new Error(`dist/server/index.js topilmadi. Avval "npm run build" bajarilishi kerak. dist ichida: ${listDir(dist)}`);
  }
  console.log(`[halo] dist: ${listDir(dist)}`);
  console.log(`[halo] dist/server: ${listDir(serverDir)}`);

  const generatedPath = join(serverDir, "wrangler.json");
  let generated = null;
  if (existsSync(generatedPath)) {
    generated = JSON.parse(readFileSync(generatedPath, "utf8"));
    console.log("[halo] build yaratgan dist/server/wrangler.json ishlatiladi.");
  } else {
    generated = fallbackConfig(serverDir, clientDir);
    console.log("[halo] dist/server/wrangler.json yo'q — zaxira sozlama yoziladi.");
  }
  const config = deployConfig(generated, settings);
  const deployPath = join(serverDir, "wrangler.halo.json");
  writeFileSync(deployPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`[halo] worker=${config.name} d1=${settings.databaseName} r2=${settings.bucketName || "(ulanmagan)"} assets=${config.assets ? config.assets.directory : "(yo'q)"}`);

  const migrationsDir = join(root, ".wrangler-halo");
  mkdirSync(migrationsDir, { recursive: true });
  const migrationsPath = join(migrationsDir, "migrations.json");
  writeFileSync(migrationsPath, `${JSON.stringify({
    name: settings.workerName,
    compatibility_date: config.compatibility_date,
    d1_databases: [d1Binding(settings, join(root, "drizzle"))],
  }, null, 2)}\n`);

  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", migrationsPath], root);
  run("npx", ["wrangler", "deploy", "--config", deployPath], root);
  console.log("\n[halo] Joylash tugadi.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`\n✘ [halo] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
