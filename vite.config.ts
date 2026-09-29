import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// O'z Cloudflare akkauntiga joylash (ChatGPT Sites'siz).
// Bu o'zgaruvchilar berilmasa, qiymatlar ChatGPT Sites uchun avvalgidek qoladi.
// Qarang: docs/CLOUDFLARE_KOCHISH.md
const selfHosted = {
  workerName: process.env.HALO_WORKER_NAME?.trim() || undefined,
  d1DatabaseId: process.env.HALO_D1_DATABASE_ID?.trim() || undefined,
  d1DatabaseName: process.env.HALO_D1_DATABASE_NAME?.trim() || undefined,
  r2BucketName: process.env.HALO_R2_BUCKET_NAME?.trim() || undefined,
};

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  ...(selfHosted.workerName ? { name: selfHosted.workerName } : {}),
  // Wrangler deploy sanani talab qiladi; ChatGPT Sites o'zi beradi.
  ...(selfHosted.d1DatabaseId ? { compatibility_date: "2026-06-01" } : {}),
  // O'z hostingda secretlar hali berilmagan bo'lsa ham rahbar kirishi yopiq turadi.
  ...(selfHosted.d1DatabaseId ? { vars: { HALO_SELF_HOSTED: "1" } } : {}),
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: selfHosted.d1DatabaseName || "site-creator-d1",
          database_id: selfHosted.d1DatabaseId || SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          ...(selfHosted.d1DatabaseId ? { migrations_dir: "drizzle" } : {}),
        },
      ]
    : [],
  // R2 (rasmlar) ixtiyoriy: o'z akkauntida bucket nomi berilmasa ulanmaydi,
  // rasm yuklash o'chadi, qolgan hammasi ishlaydi.
  r2_buckets: r2 && (!selfHosted.d1DatabaseId || selfHosted.r2BucketName)
    ? [
        {
          binding: r2,
          bucket_name: selfHosted.r2BucketName || "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
