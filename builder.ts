/**
 * Directory-based router builder for web applications.
 *
 * This module provides a builder that walks a directory structure and
 * creates routes for server endpoints, client SPA pages, and static assets.
 *
 * @module
 * @since 0.1.0
 */

import type { Schema } from "@baetheus/fun/schemable";

import * as Array from "@baetheus/fun/array";
import * as Effect from "@baetheus/fun/effect";
import * as Either from "@baetheus/fun/either";
import * as Err from "@baetheus/fun/err";
import * as Option from "@baetheus/fun/option";
import * as Refinement from "@baetheus/fun/refinement";
import { flow, pipe } from "@baetheus/fun/fn";

import * as Path from "@std/path";

import type * as Tokens from "./tokens.ts";
import * as Router from "./router.ts";

/**
 * Error factory for route building failures.
 *
 * @example
 * ```ts
 * import { build_error } from "@baetheus/pick/builder";
 *
 * const error = build_error("Failed to process file", { path: "/src/routes" });
 * ```
 *
 * @since 0.1.0
 */
export const build_error: Err.ErrFactory<"BuildError"> = Err.err(
  "BuildError",
);

/**
 * Effect type used by builders for async operations with BuildConfig context.
 *
 * @example
 * ```ts
 * import type { BuildEffect } from "@baetheus/pick/builder";
 *
 * function myOperation(): BuildEffect<string[]> {
 *   return Effect.gets((config) => ["route1", "route2"]);
 * }
 * ```
 *
 * @since 0.1.0
 */
export type BuildEffect<A> = Effect.Effect<
  [BuildConfig],
  Err.AnyErr,
  A,
  [BuildConfig]
>;

/**
 * Represents a file entry returned by the directory walker.
 *
 * @example
 * ```ts
 * import type { FileEntry } from "@baetheus/pick/builder";
 *
 * const entry: FileEntry = {
 *   parsed_path: { root: "/", dir: "/src", base: "index.ts", ext: ".ts", name: "index" },
 *   absolute_path: "/src/index.ts",
 *   relative_path: "/index.ts",
 *   mime_type: Option.some("text/typescript"),
 * };
 * ```
 *
 * @since 0.1.0
 */
export type FileEntry = {
  // Parsed path
  readonly parsed_path: Path.ParsedPath;
  // Absolute path to file
  readonly absolute_path: string;
  // Relative path from config root to file, always starts with a slash
  readonly relative_path: string;
  // Optional: Mime type of the file
  readonly mime_type: Option.Option<string>;
};

/**
 * Creates a FileEntry from the given parameters.
 *
 * @example
 * ```ts
 * import { file_entry } from "@baetheus/pick/builder";
 * import * as Option from "@baetheus/fun/option";
 * import { parse } from "@std/path";
 *
 * const entry = file_entry(
 *   parse("/src/routes/index.ts"),
 *   "/routes/index.ts",
 *   Option.some("text/typescript")
 * );
 * ```
 *
 * @since 0.1.0
 */
export function file_entry(
  parsed_path: Path.ParsedPath,
  relative_path: string,
  mime_type: Option.Option<string>,
): FileEntry {
  return {
    parsed_path,
    relative_path: relative_path.startsWith("/")
      ? relative_path
      : `/${relative_path}`,
    mime_type,
    absolute_path: Path.format(parsed_path),
  };
}

/**
 * A route tagged with its source builder and file path.
 *
 * @example
 * ```ts
 * import type { FullRoute } from "@baetheus/pick/builder";
 *
 * const route: FullRoute = {
 *   builder: "ServerBuilder",
 *   absolute_path: "/src/routes/api.ts",
 *   parsed_path: parse("/src/routes/api.ts"),
 *   route: myRoute,
 * };
 * ```
 *
 * @since 0.1.0
 */
export type FullRoute = {
  readonly builder: string;
  readonly absolute_path: string;
  readonly parsed_path: Path.ParsedPath;
  readonly route: Router.Route;
  readonly params_schema: Option.Option<Schema<unknown>>;
  readonly body_schema: Option.Option<Schema<unknown>>;
  readonly output_schema: Option.Option<Schema<unknown>>;
};

/**
 * Creates a tagged route from builder name, path, and route.
 *
 * @example
 * ```ts
 * import { full_route } from "@baetheus/pick/builder";
 * import * as Router from "@baetheus/pick/router";
 * import { parse } from "@std/path";
 *
 * const route = full_route(
 *   "MyBuilder",
 *   parse("/src/api.ts"),
 *   Router.route("GET", "/api", myHandler)
 * );
 * ```
 *
 * @since 0.1.0
 */
export function full_route(
  builder: string,
  parsed_path: Path.ParsedPath,
  route: Router.Route,
  params_schema: Option.Option<Schema<unknown>> = Option.none,
  body_schema: Option.Option<Schema<unknown>> = Option.none,
  output_schema: Option.Option<Schema<unknown>> = Option.none,
): FullRoute {
  return {
    builder,
    route,
    parsed_path,
    absolute_path: Path.format(parsed_path),
    params_schema,
    body_schema,
    output_schema,
  };
}

/**
 * A collection of FullRoute objects representing all routes in a site.
 *
 * @example
 * ```ts
 * import type { SiteRoutes } from "@baetheus/pick/builder";
 *
 * const routes: SiteRoutes = [route1, route2, route3];
 * ```
 *
 * @since 0.1.0
 */
export type SiteRoutes = readonly FullRoute[];

/**
 * Walks a directory and yields WalkEntry objects.
 *
 * @since 0.3.0
 */
function walk_directory(
  path: string,
): BuildEffect<readonly FileEntry[]> {
  return Effect.tryCatch(
    (config) => config.fs.walk(path),
    (error, config) =>
      build_error("Error while walking directory", { error, config, path }),
  );
}

/**
 * Options for creating temporary files.
 *
 * @example
 * ```ts
 * import type { MakeTempOptions } from "@baetheus/pick/builder";
 *
 * const options: MakeTempOptions = {
 *   prefix: "bundle-",
 *   suffix: ".ts",
 * };
 * ```
 *
 * @since 0.3.0
 */
export type MakeTempOptions = {
  readonly dir?: string;
  readonly prefix?: string;
  readonly suffix?: string;
};

/**
 * Filesystem abstraction interface for the builder.
 *
 * Allows different filesystem implementations (Deno, Node, etc.) to be used
 * with the build system.
 *
 * @example
 * ```ts
 * import type { Filesystem } from "@baetheus/pick/builder";
 * import { deno_fs } from "@baetheus/pick/deno_fs";
 *
 * const fs: Filesystem = deno_fs;
 * ```
 *
 * @since 0.1.0
 */
export type Filesystem = {
  /** Creates a temporary file that is writable and readable, returns the path */
  readonly makeTempFile: (options?: MakeTempOptions) => Promise<string>;
  /** Walk takes a directory path and returns an array of FileEntries (files only) */
  readonly walk: (root: string) => Promise<readonly FileEntry[]>;
  /** Read takes a ParsedPath and returns a readable stream of that file */
  readonly read: (
    path: Path.ParsedPath,
  ) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
  /** Write takes a ParsedPath and data to write to the file */
  readonly write: (
    path: Path.ParsedPath,
    data: Uint8Array | ReadableStream<Uint8Array>,
  ) => Promise<void>;
};

/**
 * Interface for route builders that process files and generate routes.
 *
 * @example
 * ```ts
 * import type { Builder } from "@baetheus/pick/builder";
 * import * as Effect from "@baetheus/fun/effect";
 *
 * const myBuilder: Builder = {
 *   name: "MyBuilder",
 *   process_file: (entry) => Effect.right([]),
 *   process_build: (routes) => Effect.right([]),
 * };
 * ```
 *
 * @since 0.1.0
 */
export type Builder = {
  readonly name: string;
  readonly process_file: (entry: FileEntry) => BuildEffect<SiteRoutes>;
  readonly process_build: (routes: SiteRoutes) => BuildEffect<SiteRoutes>;
};

/**
 * Configuration for the site builder.
 *
 * @example
 * ```ts
 * import type { BuildConfig } from "@baetheus/pick/builder";
 * import { deno_fs } from "@baetheus/pick/deno_fs";
 * import { server_builder } from "@baetheus/pick/builder_server";
 *
 * const config: BuildConfig = {
 *   root_path: "./src/routes",
 *   fs: deno_fs,
 *   unsafe_import: (path) => import(path),
 *   builders: [server_builder({})],
 * };
 * ```
 *
 * @since 0.1.0
 */
export type BuildConfig = {
  readonly root_path: string;
  readonly fs: Filesystem;
  readonly unsafe_import: (path: string) => Promise<unknown>;
  readonly builders: readonly Builder[];
};

function strip_extension(path: string): string {
  const parsed_path = Path.parse(Path.normalize(path));
  const stripped = Path.join(parsed_path.dir, parsed_path.name);
  return stripped;
}

/**
 * Converts a PartialRoute token to a full Route with file path information.
 *
 * @example
 * ```ts
 * import { from_partial_route } from "@baetheus/pick/builder";
 * import { get } from "@baetheus/pick/tokens";
 *
 * const partial = get(myHandler);
 * const full = from_partial_route("MyBuilder", fileEntry, partial);
 * ```
 *
 * @since 0.1.0
 */
export function from_partial_route(
  builder: string,
  file_entry: FileEntry,
  { method, handler, params_schema, body_schema, output_schema }:
    Tokens.PartialRoute,
): FullRoute {
  return full_route(
    builder,
    file_entry.parsed_path,
    Router.route(method, strip_extension(file_entry.relative_path), handler),
    params_schema,
    body_schema,
    output_schema,
  );
}

/**
 * Wraps a handler with an array of middleware functions.
 *
 * @example
 * ```ts
 * import { wrap_handler } from "@baetheus/pick/builder";
 *
 * const wrapped = wrap_handler(myHandler, [loggingMiddleware, authMiddleware]);
 * ```
 *
 * @since 0.1.0
 */
export function wrap_handler(
  handler: Router.Handler,
  middlewares: readonly Router.Middleware<unknown>[],
): Router.Handler {
  return pipe(
    middlewares,
    Array.fold((handler, middleware) => middleware(handler), handler),
  );
}

/**
 * Wraps a PartialRoute's handler with middleware functions.
 *
 * @example
 * ```ts
 * import { wrap_partial_route } from "@baetheus/pick/builder";
 * import { get } from "@baetheus/pick/tokens";
 *
 * const partial = get(myHandler);
 * const wrapped = wrap_partial_route(partial, [authMiddleware]);
 * ```
 *
 * @since 0.1.0
 */
export function wrap_partial_route(
  partial_route: Tokens.PartialRoute,
  middlewares: readonly Router.Middleware<unknown>[],
): Tokens.PartialRoute {
  return {
    ...partial_route,
    handler: wrap_handler(partial_route.handler, middlewares),
  };
}

/**
 * Find the export name of a value by object equality.
 *
 * @example
 * ```ts
 * import { findExportNameByEquality } from "@baetheus/pick/builder";
 * import * as Option from "@baetheus/fun/option";
 *
 * const exports = { myRoute: routeObj, other: {} };
 * const name = findExportNameByEquality(exports, routeObj);
 * // Option.some("myRoute")
 * ```
 *
 * @since 0.3.0
 */
export function findExportNameByEquality(
  exports: Record<string, unknown>,
  target: unknown,
): Option.Option<string> {
  for (const [name, value] of Object.entries(exports)) {
    if (value === target) {
      return Option.some(name);
    }
  }
  return Option.none;
}

/**
 * Result of building a site, containing config and generated routes.
 *
 * @example
 * ```ts
 * import type { SiteBuildResult } from "@baetheus/pick/builder";
 *
 * const result: SiteBuildResult = {
 *   config: buildConfig,
 *   site_routes: [route1, route2],
 * };
 * ```
 *
 * @since 0.3.0
 */
export type SiteBuildResult = {
  readonly config: BuildConfig;
  readonly site_routes: SiteRoutes;
};

const traverse = Array.traverse(Effect.getFlatmappableEffect<[BuildConfig]>());

/**
 * Safely imports a module and returns its exports as a record.
 *
 * @example
 * ```ts
 * import { safe_import } from "@baetheus/pick/builder";
 * import { parse } from "@std/path";
 *
 * const exports = safe_import(parse("/src/routes/api.ts"));
 * ```
 *
 * @since 0.1.0
 */
export function safe_import(
  path: Path.ParsedPath,
): BuildEffect<Record<string, unknown>> {
  return Effect.tryCatch(
    async (config) => {
      const raw_import = await config.unsafe_import(
        "file://" + Path.format(path),
      );
      if (Refinement.isRecord(raw_import)) {
        return raw_import;
      }
      throw new Error("Unable to parse import object from unsafe_import");
    },
    (error, args) =>
      build_error("Error thrown by unsafe_import", { error, args }),
  );
}

/**
 * Builds a site from a directory by walking the file system and processing
 * files through configured builders.
 *
 * Returns route information, metadata, and bundle data without initializing
 * a router. Use `Router.router()` to create a router from the returned routes.
 *
 * @example
 * ```ts
 * import { build } from "@baetheus/pick/builder";
 * import { deno_fs } from "@baetheus/pick/deno_fs";
 * import { server_builder } from "@baetheus/pick/builder_server";
 * import { static_builder } from "@baetheus/pick/builder_static";
 * import * as Either from "@baetheus/fun/either";
 *
 * const result = await build({
 *   root_path: "./src/routes",
 *   fs: deno_fs,
 *   unsafe_import: (path) => import(path),
 *   builders: [
 *     server_builder({}),
 *     static_builder({ exclude_extensions: [".ts"] }),
 *   ],
 * });
 *
 * if (Either.isRight(result)) {
 *   const routes = result.right.site_routes;
 * }
 * ```
 *
 * @since 0.1.0
 */
export function build(
  config: BuildConfig,
): Promise<Either.Either<Err.AnyErr, SiteBuildResult>> {
  if (config.builders.length === 0) {
    return Promise.resolve(Either.left(
      build_error("No builders specified in configuration", { config }),
    ));
  }

  return pipe(
    walk_directory(config.root_path),
    // Traverse each FileEntry
    Effect.flatmap(traverse((entry) =>
      pipe(
        // Traverse Each Builder.process_file(file_entry)
        config.builders.map((builder) => builder.process_file(entry)),
        // Use Traverse to join each builder's SiteRoutes into SiteRoutes[]
        traverse((routes_effect) => routes_effect),
      )
    )),
    // Flatten SiteRoutes[][] into SiteRoutes (one layer per traverse)
    Effect.map(flow(Array.join, Array.join)),
    Effect.flatmap((site_routes) =>
      Effect.getsEither(async (config) => {
        const routes = [...site_routes];
        // Loop through each builder.process_build and aggregate
        // the returned SiteRoutes
        for (const builder of config.builders) {
          const [result] = await builder.process_build(routes)(config);
          // Bail early if a builder errors
          if (Either.isLeft(result)) {
            return result;
          }
          routes.push(...result.right);
        }
        return Either.right(routes);
      })
    ),
    Effect.map((site_routes) => ({ config, site_routes })),
    Effect.evaluate(config),
  );
}
