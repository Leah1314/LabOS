/// <reference types="@cloudflare/workers-types" />

/**
 * Declares this Worker's bindings.
 *
 * Before this file, `cloudflare:workers` did not resolve at all, so `env` was
 * `any` and every D1 call in the app — bindings, prepared statements, batches —
 * was completely unchecked by TypeScript. Four type errors were being reported
 * and ignored; the real cost was that nothing touching the database was typed.
 *
 * `Cloudflare.Env` is declaration-merged, which is the interface the runtime
 * types expect a project to extend. `wrangler types` can generate this file
 * once a wrangler config exists.
 */
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    IMAGES: {
      input(stream: ReadableStream): {
        transform(options: Record<string, unknown>): {
          output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
        };
      };
    };
  }
}
