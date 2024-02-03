import type { Option } from "fun/option";

import type { Context } from "./context.ts";
import type { Handler } from "./handler.ts";
import type { RouteParser, RouteString } from "./parser.ts";

import { some } from "fun/option";

export type Route<V, S> = {
  readonly route: RouteString;
  readonly parser: RouteParser<V>;
  readonly handler: Handler<Context<S, V>, Response, unknown>;
};

// deno-lint-ignore no-explicit-any
export type AnyRoute<S> = Route<any, S>;

export function route<V, S>(
  route: RouteString,
  parser: RouteParser<V>,
  handler: Handler<Context<S, V>, Response, unknown>,
): Route<V, S> {
  return { route, parser, handler };
}

const emptyPath = some({}) as Option<unknown>;
const NotFound = new Response("Not Found", { status: 404 });

/**
 * Default 404 Route
 */
export function notFound<S>(): AnyRoute<S> {
  return route(
    "GET /*",
    () => emptyPath,
    (s) => Promise.resolve([NotFound, s]),
  );
}
