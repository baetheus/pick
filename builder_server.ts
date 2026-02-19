import * as Option from "@baetheus/fun/option";
import * as Array from "@baetheus/fun/array";
import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import * as Path from "@std/path";
import * as Refinement from "@baetheus/fun/refinement";
import { pipe } from "@baetheus/fun/fn";

import type * as Router from "./router.ts";
import * as Tokens from "./tokens.ts";
import * as Builder from "./builder.ts";

const server_builder_error = Err.err("ServerBuilderError");

export type ServerBuilderOptions = {
  readonly name: string;
  readonly middleware: Router.Middleware<unknown>[];
  readonly include_extensions: string[];
};

export function safe_import(
  parsed_path: Path.ParsedPath,
): Builder.BuildEffect<Record<string, unknown>> {
  return Effect.tryCatch(
    async (_) => {
      const result = await import("file://" + Path.format(parsed_path));
      if (Refinement.isRecord(result)) {
        return result;
      }
      throw new Error("Import did not return a record type.");
    },
    (error) =>
      server_builder_error("Unable to import file.", { error, parsed_path }),
  );
}

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
    process_build: (routes) => Effect.right(routes),
    process_file: (file_entry) => {
      if (!include_extensions.includes(file_entry.parsed_path.ext)) {
        return Effect.right([]);
      }

      return pipe(
        safe_import(file_entry.parsed_path),
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
