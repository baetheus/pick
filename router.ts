import type { Context } from "./context.ts";
import type { PathVars, RouteString } from "./parser.ts";
import type { Handler } from "./handler.ts";
import type { Route } from "./route.ts";

import { append } from "fun/array.ts";
import { isSome } from "fun/option.ts";
import { pipe } from "fun/fn.ts";

import { evaluate, puts } from "./handler.ts";
import { routeParser } from "./parser.ts";
import { route } from "./route.ts";
import { context } from "./context.ts";

// deno-lint-ignore no-explicit-any
export type Router<S = unknown> = readonly Route<any, S>[];

export function router<S>(): Router<S> {
  return [];
}

export function handle<R extends RouteString, S, O>(
  routeString: R,
  handler: Handler<Context<S, PathVars<R>>, Response, O>,
): (router: Router<S>) => Router<S> {
  const parser = routeParser(routeString);
  return append(route(routeString, parser, handler));
}

export function respond<R extends RouteString, S>(
  routeString: R,
  handler: (ctx: Context<S, PathVars<R>>) => Response | Promise<Response>,
): (router: Router<S>) => Router<S> {
  return handle(routeString, puts(handler));
}

const NotFound = new Response("Not Found", { status: 404 });

export function use<S>(
  state: S,
  notFound: (req: Request) => Response = () => NotFound,
): (router: Router<S>) => Deno.ServeHandler {
  return (router) => (request) => {
    for (const { parser, handler } of router) {
      const path = parser(request);
      // Found a matching route
      if (isSome(path)) {
        return pipe(handler, evaluate(context(request, state, path.value)));
      }
    }
    // Default route
    return notFound(request);
  };
}
