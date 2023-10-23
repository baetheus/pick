import type { Comparable } from "fun/comparable.ts";
import type { Handler, Responder } from "./handler.ts";
import type { Context } from "./context.ts";

import * as M from "fun/map.ts";
import * as C from "fun/comparable.ts";
import { isNone } from "fun/option.ts";
import { pipe } from "fun/fn.ts";

import { fromHandler, fromResponder } from "./handler.ts";

export function simpleCache<S>(
  C: Comparable<S>,
): <A, O>(handler: Handler<S, A, O>) => Handler<S, A, O> {
  const lookup = M.lookup(C);
  return <A, O>(handler: Handler<S, A, O>): Handler<S, A, O> => {
    const cache = new Map<S, [A, O]>();
    return async (s) => {
      const cached = lookup(s)(cache);
      if (isNone(cached)) {
        const value = await handler(s);
        cache.set(s, value);
        return value;
      }
      return cached.value;
    };
  };
}

export function cacheUrl<S, V>(
  responder: Responder<Context<S, V>, Response>,
): Responder<Context<S, V>, Response> {
  const comparable = pipe(
    C.string,
    C.premap((ctx: Context<S, V>) => ctx.request.url),
  );

  // This seems a bit convoluted just to line up types for the
  // "handle" function in router.ts. But the Handler type definitely
  // seems like the right abstraction. Maybe it's ok.
  return pipe(
    responder,
    fromResponder,
    simpleCache(comparable),
    fromHandler,
  );
}
