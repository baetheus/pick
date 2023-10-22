import type { PathVars, RouteString } from "./parser.ts";
import type { Handler } from "./handler.ts";
import type { Route } from "./route.ts";

import * as A from "fun/array.ts";
import * as O from "fun/option.ts";

import { routeParser } from "./parser.ts";
import { route } from "./route.ts";
import { context } from "./context.ts";

// deno-lint-ignore no-explicit-any
export type Router<S = unknown> = readonly Route<any, S>[];

export function router<S>(): Router<S> {
  return [];
}

export function handle<R extends RouteString, S>(
  routeString: R,
  handler: Handler<PathVars<R>, S>,
): (router: Router<S>) => Router<S> {
  const parser = routeParser(routeString);
  return A.append(route(routeString, parser, handler));
}

const NotFound = new Response("Not Found", { status: 404 });

export function use<S>(
  state: S,
): (router: Router<S>) => Deno.ServeHandler {
  return (router) => (request) => {
    for (const route of router) {
      const variables = route.parser(request);
      if (O.isNone(variables)) {
        continue;
      }
      return route.handler(context(request, variables.value, state));
    }
    return NotFound;
  };
}
