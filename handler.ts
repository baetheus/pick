import type { Context } from "./context.ts";

/**
 * Handle a request with Context as input.
 */
export type Handler<Vars, S = unknown> = (
  ctx: Context<Vars, S>,
) => Response | Promise<Response>;

export function simpleCache<V, S>(
  handler: Handler<V, S>,
  useCache: (ctx: Context<V, S>) => boolean | Promise<boolean>,
): Handler<V, S> {
  const cache = new Map<string, Response>();

  return async (ctx) => {
    const url = ctx.request.url.toLowerCase();

    if (cache.has(url) && await useCache(ctx)) {
      return cache.get(url) as Response;
    } else {
      const response = await handler(ctx);
      cache.set(url, response);
      return response;
    }
  };
}

export function alwaysCache<V, S>(handler: Handler<V, S>): Handler<V, S> {
  return simpleCache(handler, () => true);
}
