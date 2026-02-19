import * as Option from "@baetheus/fun/option";
import * as Array from "@baetheus/fun/array";
import * as Effect from "@baetheus/fun/effect";
import { pipe } from "@baetheus/fun/fn";

import type * as Router from "./router.ts";
import * as Tokens from "./tokens.ts";
import * as Builder from "./builder.ts";

/**
 * Configuration options for the server builder.
 *
 * @example
 * ```ts
 * import type { ServerBuilderOptions } from "@baetheus/pick/builder_server";
 *
 * const options: ServerBuilderOptions = {
 *   name: "MyServerBuilder",
 *   middleware: [loggingMiddleware],
 *   include_extensions: [".ts", ".tsx"],
 * };
 * ```
 *
 * @since 0.1.0
 */
export type ServerBuilderOptions = {
  readonly name: string;
  readonly middleware: Router.Middleware<unknown>[];
  readonly include_extensions: string[];
};

const filterPartialRoute = Option.fromPredicate(Tokens.is_partial_route);

function wrap_handler(
  handler: Router.Handler,
  middlewares: readonly Router.Middleware<unknown>[],
): Router.Handler {
  return pipe(
    middlewares,
    Array.fold((handler, middleware) => middleware(handler), handler),
  );
}

function wrap_partial_route(
  partial_route: Tokens.PartialRoute,
  middlewares: readonly Router.Middleware<unknown>[],
): Tokens.PartialRoute {
  return {
    ...partial_route,
    handler: wrap_handler(partial_route.handler, middlewares),
  };
}

/**
 * Builds server routes from a file entry.
 *
 * Scans files for exported PartialRoute tokens (created via get, post, etc.)
 * and converts them into full routes that can be used by the router.
 *
 * @example
 * ```ts
 * import { server_builder } from "@baetheus/pick/builder_server";
 *
 * const builder = server_builder({
 *   name: "ApiBuilder",
 *   middleware: [authMiddleware],
 *   include_extensions: [".ts"],
 * });
 * ```
 *
 * @since 0.1.0
 */
export function server_builder(
  {
    name = "DefaultServerBuilder",
    middleware = [],
    include_extensions = [".ts", ".tsx"],
  }: Partial<ServerBuilderOptions>,
): Builder.Builder {
  return {
    name: name,
    process_build: () => Effect.right([]),
    process_file: (file_entry) => {
      if (!include_extensions.includes(file_entry.parsed_path.ext)) {
        return Effect.right([]);
      }

      return pipe(
        Builder.safe_import(file_entry.parsed_path),
        Effect.map((exports) =>
          pipe(
            Object.values(exports),
            Array.filterMap(filterPartialRoute),
            Array.map((partial_route) =>
              Builder.from_partial_route(
                name,
                file_entry,
                wrap_partial_route(partial_route, middleware),
              )
            ),
          )
        ),
      );
    },
  };
}
