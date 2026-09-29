/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { applyOwnerAuth, type OwnerAuthEnv } from "./owner-auth";

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
};

export default worker;
