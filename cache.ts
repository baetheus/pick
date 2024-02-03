import type { Comparable } from "fun/comparable";
import type { Handler } from "./handler.ts";
import type { Context } from "./context.ts";

import * as C from "fun/comparable";
import { lookup } from "fun/map";
import { isNone } from "fun/option";
import { pipe } from "fun/fn";

export function simpleCache<S>(
  C: Comparable<S>,
): <A, O>(handler: Handler<S, A, O>) => Handler<S, A, O> {
  const _lookup = lookup(C);
  return <A, O>(handler: Handler<S, A, O>): Handler<S, A, O> => {
    const cache = new Map<S, [A, O]>();
    return async (s) => {
      const cached = _lookup(s)(cache);
      if (isNone(cached)) {
        const value = await handler(s);
        cache.set(s, value);
        return value;
      }
      return cached.value;
    };
  };
}

export function cacheUrl<S, V, A, O>(
  handler: Handler<Context<S, V>, A, O>,
): Handler<Context<S, V>, A, O> {
  const comparable = pipe(
    C.string,
    C.premap((ctx: Context<S, V>) => ctx.request.url.toLowerCase()),
  );

  return pipe(
    handler,
    simpleCache(comparable),
  );
}
