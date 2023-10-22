import type { RouteParser, RouteString, PathVars } from "./parser.ts";
import type { Handler } from "./handler.ts";

export type Route<V, S> = {
  readonly route: RouteString;
  readonly parser: RouteParser<V>;
  readonly handler: Handler<V, S>;
};

export function route<V, S>(
  route: RouteString,
  parser: RouteParser<V>,
  handler: Handler<V, S>,
): Route<V, S> {
  return { route, parser, handler };
}

