import type { Router } from "./router.ts";
import type { Context } from "./context.ts";
import type { Route } from "./route.ts";
import type { Handler } from "./handler.ts";

import { nanoid } from "@jlarky/nanoid";
import * as E from "fun/either";
import { pipe } from "fun/fn";
import { map } from "fun/array";

import { route } from "./route.ts";

const stringify = E.tryCatch(JSON.stringify, String);
const tryLog = (data: unknown): void =>
  pipe(
    stringify(data),
    E.match(
      (err) =>
        console.error({
          timestamp: Date.now(),
          msg: "Unable to log data",
          err,
        }),
      console.log,
    ),
  );

export function logHandler<S, V, O>(
  handler: Handler<Context<S, V>, Response, O>,
): Handler<Context<S, V>, Response, O> {
  return async (ctx) => {
    const start = Date.now();
    const id = nanoid();
    const { request, state, path } = ctx;
    const { method, url } = request;
    tryLog({ id, timestamp: start, method, url, state, path });

    const output = await handler(ctx);

    const [response] = output;
    const { status } = response;
    const end = Date.now();
    const responseTime = end - start;
    tryLog({
      id,
      timestamp: end,
      responseTime,
      status,
    });
    return output;
  };
}

export function logRoute<S, V>(r: Route<V, S>): Route<V, S> {
  return route(r.route, r.parser, logHandler(r.handler));
}

export function logRouter<S>(router: Router<S>): Router<S> {
  return pipe(router, map(logRoute));
}
