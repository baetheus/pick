/**
 * Directory-based router builder for web applications.
 *
 * This module provides a builder that walks a directory structure and
 * creates routes for server endpoints, client SPA pages, and static assets.
 *
 * @module
 * @since 0.1.0
 */

import * as Array from "@baetheus/fun/array";
import * as Effect from "@baetheus/fun/effect";
import * as Either from "@baetheus/fun/either";
import * as Err from "@baetheus/fun/err";
import * as Option from "@baetheus/fun/option";
import * as Record from "@baetheus/fun/record";
import { flow, pipe } from "@baetheus/fun/fn";

import * as Path from "@std/path";

import * as Router from "./router.ts";
import * as Tokens from "./tokens.ts";

/**
 * Error type for route building failures.
 *
 * @since 0.1.0
 */
export const build_error: Err.ErrFactory<"BuildError"> = Err.err(
  "BuildError",
);

export type BuildEffect<A> = Effect.Effect<
  [BuildConfig],
  Err.AnyErr,
  A,
  [BuildConfig]
>;

/**
 * Represents a file entry returned by the directory walker.
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
 * A route tagged with its source and type.
 *
 * @since 0.1.0
 */
export type FullRoute = {
  readonly builder: string;
  readonly absolute_path: string;
  readonly parsed_path: Path.ParsedPath;
  readonly route: Router.Route;
};

/**
 * Creates a tagged route.
 *
 * @since 0.1.0
 */
export function full_route(
  builder: string,
  parsed_path: Path.ParsedPath,
  route: Router.Route,
): FullRoute {
  return {
    builder,
    route,
    parsed_path,
    absolute_path: Path.format(parsed_path),
  };
}

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

export type Filesystem = {
  // Walk takes a directory path and returns an array of FileEntries
  // which must all be files and not directories.
  readonly walk: (root: string) => Promise<readonly FileEntry[]>;
  // Read takes a ParsedPath and returns a readable stream of that file.
  readonly read: (
    path: Path.ParsedPath,
  ) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
};

export type Builder = {
  readonly name: string;
  readonly process_file: (entry: FileEntry) => BuildEffect<SiteRoutes>;
  readonly process_build: (routes: SiteRoutes) => BuildEffect<SiteRoutes>;
};

/**
 * Configuration for the site builder.
 *
 * @since 0.1.0
 */
export type BuildConfig = {
  readonly root_path: string;
  readonly fs: Filesystem;
  readonly builders: readonly Builder[];
};

/**
 * Converts a PartialRoute to a full Route.
 *
 * @since 0.1.0
 */
export function from_partial_route(
  builder: string,
  file_entry: FileEntry,
  { method, handler }: Tokens.PartialRoute,
): FullRoute {
  return full_route(
    builder,
    file_entry.parsed_path,
    Router.route(method, file_entry.relative_path, handler),
  );
}

export function wrap_handler(
  handler: Router.Handler,
  middlewares: readonly Router.Middleware<unknown>[],
): Router.Handler {
  return pipe(
    middlewares,
    Array.fold((handler, middleware) => middleware(handler), handler),
  );
}

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
 * Result of building a site.
 *
 * @since 0.3.0
 */
export type SiteBuildResult = {
  readonly config: BuildConfig;
  readonly site_routes: SiteRoutes;
};

const traverse = Array.traverse(Effect.getFlatmappableEffect<[BuildConfig]>());

/**
 * Builds a site from a directory.
 *
 * Returns route information, metadata, and bundle data without initializing
 * a router. Use `Router.router()` to create a router from the returned routes.
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
      pipe(
        // Give each builder the full site_routes array to make additional routes
        config.builders.map((builder) => builder.process_build(site_routes)),
        traverse((routes_effect) => routes_effect),
      )
    ),
    // Join the SiteRoutes[] again
    Effect.map((site_routes_routes) => ({
      config,
      site_routes: Array.join(site_routes_routes),
    })),
    Effect.evaluate(config),
  );
}
