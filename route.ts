import type { Context } from "./context.ts";
import type { Handler } from "./handler.ts";
import type { RouteParser, RouteString } from "./parser.ts";

export type Route<V, S> = {
  readonly route: RouteString;
  readonly parser: RouteParser<V>;
  readonly handler: Handler<Context<S, V>, Response, unknown>;
};

export function route<V, S>(
  route: RouteString,
  parser: RouteParser<V>,
  handler: Handler<Context<S, V>, Response, unknown>,
): Route<V, S> {
  return { route, parser, handler };
}
