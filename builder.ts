/**
 * Directory-based router builder for web applications.
 *
 * This module provides a generic builder that walks a directory structure and
 * creates a Router with server routes, client SPA routes, and static assets.
 * The builder is framework-agnostic and relies on platform-specific tools
 * provided via BuilderTools.
 *
 * @module
 * @since 0.1.0
 */

import type { Decoded, Decoder } from "fun/decoder";
import type { Schema } from "fun/schemable";

import * as A from "fun/array";
import * as D from "fun/decoder";
import * as E from "fun/effect";
import * as Either from "fun/either";
import * as Err from "fun/err";
import * as I from "fun/initializable";
import * as O from "fun/option";
import * as Rec from "fun/record";
import * as Ref from "fun/refinement";
import { pipe } from "fun/fn";

import * as R from "./router.ts";

const PartialRouteSymbol: unique symbol = Symbol("pick/partial_route");
type PartialRouteSymbol = typeof PartialRouteSymbol;

const ClientRedirectSymbol: unique symbol = Symbol("pick/client_redirect");
type ClientRedirectSymbol = typeof ClientRedirectSymbol;

const ClientRootSymbol: unique symbol = Symbol("pick/client_root");
type ClientRootSymbol = typeof ClientRootSymbol;

/**
 * Represents a file entry returned by the directory walker.
 *
 * @since 0.1.0
 */
export type FileEntry = {
  readonly absolute_path: string;
  readonly relative_path: string;
  readonly filename: string;
  readonly extension: string;
  readonly mime_type: O.Option<string>;
  readonly stream: () => Promise<ReadableStream<Uint8Array>>;
};

/**
 * Creates a FileEntry from the given parameters.
 *
 * @since 0.1.0
 */
export function file_entry(
  absolute_path: string,
  relative_path: string,
  filename: string,
  extension: string,
  mime_type: O.Option<string>,
  stream: () => Promise<ReadableStream<Uint8Array>>,
): FileEntry {
  return {
    absolute_path,
    relative_path,
    filename,
    extension,
    mime_type,
    stream,
  };
}

/**
 * Raw entry from a directory walk operation.
 *
 * @since 0.1.0
 */
export type WalkEntry = {
  readonly is_file: boolean;
  readonly is_directory: boolean;
  readonly is_symlink: boolean;
  readonly name: string;
  readonly path: string;
};

/**
 * Parses a filesystem path into a URLPattern-compatible pathname.
 *
 * Handles:
 * - `:param/` directories → `:param` segments
 * - `*.ts` → `*` wildcard
 * - Strips configurable extensions
 *
 * @since 0.1.0
 */
export function parse_path(
  relative_path: string,
  extensions: readonly string[],
): string {
  let pathname = relative_path;

  // Strip extension
  for (const ext of extensions) {
    if (pathname.endsWith(ext)) {
      pathname = pathname.slice(0, -ext.length);
      break;
    }
  }

  // Handle wildcard filename
  if (pathname.endsWith("/*") || pathname === "*") {
    // Already correct for URLPattern
  }

  // Ensure leading slash
  if (!pathname.startsWith("/")) {
    pathname = "/" + pathname;
  }

  return pathname;
}

/**
 * Counts the number of path parameters in a pathname.
 * Used for determining route specificity.
 *
 * @since 0.1.0
 */
export function count_params(pathname: string): number {
  const params = pathname.match(/:[^/]+/g);
  const wildcards = pathname.match(/\*/g);
  return (params?.length ?? 0) + (wildcards?.length ?? 0);
}

/**
 * Compares two routes by specificity for sorting.
 * Routes with fewer params have higher specificity (sorted first).
 *
 * @since 0.1.0
 */
export function compare_specificity(a: string, b: string): number {
  return count_params(a) - count_params(b);
}

/**
 * Config object for PartialRoute builders with typed params.
 *
 * @since 0.1.0
 */
export type PartialRouteConfig<P, D> = {
  readonly params: Schema<P>;
  readonly handler: R.Handler<D>;
};

/**
 * A partial route definition containing method, handler, and optional schema.
 *
 * @since 0.1.0
 */
export type PartialRoute<D = unknown> = {
  readonly type: PartialRouteSymbol;
  readonly method: R.Methods;
  readonly handler: R.Handler<D>;
  readonly params_schema: O.Option<Schema<unknown>>;
};

/**
 * Creates a PartialRoute with the given method and handler.
 *
 * @since 0.1.0
 */
export function partial_route<D = unknown>(
  method: R.Methods,
  handler: R.Handler<D>,
  params_schema: O.Option<Schema<unknown>> = O.none,
): PartialRoute<D> {
  return { type: PartialRouteSymbol, method, handler, params_schema };
}

/**
 * Type guard for PartialRoute.
 *
 * @since 0.1.0
 */
export function is_partial_route(value: unknown): value is PartialRoute {
  return Ref.isRecord(value) &&
    "type" in value &&
    value.type === PartialRouteSymbol;
}

/**
 * Checks if input is a PartialRouteConfig object.
 *
 * @since 0.1.0
 */
function is_config<P, D>(
  input: R.Handler<D> | PartialRouteConfig<P, D>,
): input is PartialRouteConfig<P, D> {
  return Ref.isRecord(input) && "params" in input && "handler" in input;
}

/**
 * Creates a PartialRoute builder for the given HTTP method.
 *
 * Supports two calling conventions:
 * - `method(handler)` - params is `unknown`
 * - `method({ params, handler })` - params typed via schema
 *
 * @since 0.1.0
 */
function create_method_builder(method: R.Methods) {
  function builder<D>(handler: R.Handler<D>): PartialRoute<D>;
  function builder<P, D>(config: PartialRouteConfig<P, D>): PartialRoute<D>;
  function builder<P, D>(
    input: R.Handler<D> | PartialRouteConfig<P, D>,
  ): PartialRoute<D> {
    if (is_config(input)) {
      return partial_route(
        method,
        input.handler,
        O.some(input.params as Schema<unknown>),
      );
    }
    return partial_route(method, input, O.none);
  }
  return builder;
}

/**
 * Creates a GET route handler.
 *
 * @example
 * ```ts
 * // Simple form - params is unknown
 * export const get = B.get(E.gets((req, params, ctx) => {
 *   return R.text("Hello");
 * }));
 *
 * // Config form - params is typed
 * export const get = B.get({
 *   params: schema(s => s.struct({ id: s.string() })),
 *   handler: E.gets((req, params, ctx) => {
 *     return R.text(`ID: ${params.id}`);
 *   }),
 * });
 * ```
 *
 * @since 0.1.0
 */
export const get = create_method_builder("GET");

/**
 * Creates a POST route handler.
 *
 * @since 0.1.0
 */
export const post = create_method_builder("POST");

/**
 * Creates a PUT route handler.
 *
 * @since 0.1.0
 */
export const put = create_method_builder("PUT");

/**
 * Creates a DELETE route handler.
 *
 * @since 0.1.0
 */
export const delete_ = create_method_builder("DELETE");

/**
 * Creates a PATCH route handler.
 *
 * @since 0.1.0
 */
export const patch = create_method_builder("PATCH");

/**
 * Creates a HEAD route handler.
 *
 * @since 0.1.0
 */
export const head = create_method_builder("HEAD");

/**
 * Creates an OPTIONS route handler.
 *
 * @since 0.1.0
 */
export const options = create_method_builder("OPTIONS");

/**
 * Marker type for client redirect routes.
 * Files with this as default export serve the SPA index.html.
 *
 * @since 0.1.0
 */
export type ClientRedirect = {
  readonly type: ClientRedirectSymbol;
};

/**
 * Singleton client redirect marker.
 *
 * @example
 * ```ts
 * // In a client route file
 * export default client_redirect;
 * ```
 *
 * @since 0.1.0
 */
export const client_redirect: ClientRedirect = {
  type: ClientRedirectSymbol,
};

/**
 * Type guard for ClientRedirect.
 *
 * @since 0.1.0
 */
export function is_client_redirect(value: unknown): value is ClientRedirect {
  return Ref.isRecord(value) &&
    "type" in value &&
    value.type === ClientRedirectSymbol;
}

/**
 * Marker type for client root (SPA entry point).
 *
 * @since 0.1.0
 */
export type ClientRoot = {
  readonly type: ClientRootSymbol;
  readonly component: unknown;
};

/**
 * Creates a client root marker for SPA entry points.
 *
 * @example
 * ```ts
 * // In client.tsx
 * export const client = client_root(<App />);
 * ```
 *
 * @since 0.1.0
 */
export function client_root(component: unknown): ClientRoot {
  return { type: ClientRootSymbol, component };
}

/**
 * Type guard for ClientRoot.
 *
 * @since 0.1.0
 */
export function is_client_root(value: unknown): value is ClientRoot {
  return Ref.isRecord(value) &&
    "type" in value &&
    value.type === ClientRootSymbol;
}

/**
 * A route tagged with its source and type.
 *
 * @since 0.1.0
 */
export type TaggedRoute<T extends string, D = unknown> = {
  readonly tag: T;
  readonly builder: string;
  readonly absolute_path: string;
  readonly route: R.Route<D>;
};

/**
 * Creates a tagged route.
 *
 * @since 0.1.0
 */
export function tagged_route<T extends string, D = unknown>(
  tag: T,
  absolute_path: string,
  route: R.Route<D>,
  builder: string,
): TaggedRoute<T, D> {
  return { tag, route, absolute_path, builder };
}

export type StaticRoute = TaggedRoute<"StaticRoute">;
export type ClientRoute = TaggedRoute<"ClientRoute">;
export type ServerRoute<D> = TaggedRoute<"ServerRoute", D>;
export type SiteRoute<D> = StaticRoute | ClientRoute | ServerRoute<D>;

/**
 * Creates a static route.
 *
 * @since 0.1.0
 */
export function static_route(
  absolute_path: string,
  route: R.Route,
  builder = "static_builder",
): StaticRoute {
  return tagged_route("StaticRoute", absolute_path, route, builder);
}

/**
 * Creates a client route.
 *
 * @since 0.1.0
 */
export function client_route(
  absolute_path: string,
  route: R.Route,
  builder = "client_builder",
): ClientRoute {
  return tagged_route("ClientRoute", absolute_path, route, builder);
}

/**
 * Creates a server route.
 *
 * @since 0.1.0
 */
export function server_route<D = unknown>(
  absolute_path: string,
  route: R.Route<D>,
  builder = "server_builder",
): ServerRoute<D> {
  return tagged_route("ServerRoute", absolute_path, route, builder);
}

// #endregion

// #region SiteRoutes

/**
 * Collection of all routes for a site.
 *
 * @since 0.1.0
 */
export type SiteRoutes<D = unknown> = {
  readonly static_routes: readonly StaticRoute[];
  readonly client_routes: readonly ClientRoute[];
  readonly server_routes: readonly ServerRoute<D>[];
};

/**
 * Creates a SiteRoutes object with optional initial values.
 *
 * @since 0.1.0
 */
export function site_routes<D = unknown>(
  init: Partial<SiteRoutes<D>> = {},
): SiteRoutes<D> {
  return {
    static_routes: init.static_routes ?? [],
    client_routes: init.client_routes ?? [],
    server_routes: init.server_routes ?? [],
  };
}

/**
 * Gets an Initializable instance for combining SiteRoutes.
 *
 * @since 0.1.0
 */
export function get_initializable_site_routes<D>(): I.Initializable<
  SiteRoutes<D>
> {
  return I.struct({
    static_routes: A.getInitializableArray(),
    client_routes: A.getInitializableArray(),
    server_routes: A.getInitializableArray(),
  });
}

/**
 * Extracts routes from SiteRoutes in priority order.
 *
 * @since 0.1.0
 */
export function from_site_routes<D>(
  { static_routes, client_routes, server_routes }: SiteRoutes<D>,
): R.Route<D>[] {
  // Sort each category by specificity
  const sorted_server = [...server_routes].sort((a, b) =>
    compare_specificity(a.route.pathname, b.route.pathname)
  );
  const sorted_static = [...static_routes].sort((a, b) =>
    compare_specificity(a.route.pathname, b.route.pathname)
  );
  const sorted_client = [...client_routes].sort((a, b) =>
    compare_specificity(a.route.pathname, b.route.pathname)
  );

  return [
    ...sorted_server.map((r) => r.route),
    ...sorted_static.map((r) => r.route),
    ...sorted_client.map((r) => r.route),
  ];
}

/**
 * Platform-specific tools required by the builder.
 *
 * @since 0.1.0
 */
export type BuilderTools = {
  readonly logger: R.Logger;
  readonly walk: (path: string) => AsyncIterable<WalkEntry>;
  readonly extname: (path: string) => string;
  readonly basename: (path: string) => string;
  readonly dirname: (path: string) => string;
  readonly relative: (from: string, to: string) => string;
  readonly read_stream: (path: string) => Promise<ReadableStream<Uint8Array>>;
  readonly mime_type: (extension: string) => O.Option<string>;
};

/**
 * Configuration for the site builder.
 *
 * @since 0.1.0
 */
export type SiteConfig<D = unknown> = {
  readonly root_path: string;
  readonly tools: BuilderTools;
  readonly state: D;
  readonly middlewares?: readonly R.Middleware<D>[];
  readonly server_extensions?: readonly string[];
  readonly client_extensions?: readonly string[];
  readonly static_ignore?: readonly string[];
  readonly index_html_path?: string;
};

const DEFAULT_SERVER_EXTENSIONS = [".ts"] as const;
const DEFAULT_CLIENT_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * Error type for route building failures.
 *
 * @since 0.1.0
 */
export const route_build_error = Err.err("RouteBuildError");

/**
 * Error type for route conflicts.
 *
 * @since 0.1.0
 */
export const route_conflict_error = Err.err("RouteConflictError");

// #endregion

// #region Schema Validation

/**
 * Wraps a handler with schema validation for path params.
 *
 * @since 0.1.0
 */
function wrap_with_validation<D>(
  inner_handler: R.Handler<D>,
  schema: Schema<unknown>,
): R.Handler<D> {
  const decoder = schema(D.SchemableDecoder) as Decoder<unknown, unknown>;

  return E.getsEither(
    async (req: Request, pattern: URLPatternResult, ctx: R.Ctx<D>) => {
      const params = pattern.pathname.groups;
      const decode_result: Decoded<unknown> = decoder(params);

      if (decode_result.tag === "Left") {
        const error_message = D.draw(decode_result.left);
        return Either.left(R.json(
          JSON.stringify({
            error: "Invalid path parameters",
            details: error_message,
          }),
          R.STATUS_CODE.BadRequest,
        ));
      }

      // Replace pattern groups with decoded values
      const decoded_pattern: URLPatternResult = {
        ...pattern,
        pathname: {
          ...pattern.pathname,
          groups: decode_result.right as Record<string, string | undefined>,
        },
      };

      // Call the inner handler and extract result
      const [result] = await inner_handler(req, decoded_pattern, ctx);
      return result;
    },
  );
}

// #endregion

// #region Route Builders

/**
 * Converts a PartialRoute to a full Route.
 *
 * @since 0.1.0
 */
export function from_partial_route<D = unknown>(
  pathname: string,
  pr: PartialRoute<D>,
): R.Route<D> {
  const handler = pipe(
    pr.params_schema,
    O.match(
      () => pr.handler,
      (schema) => wrap_with_validation(pr.handler, schema),
    ),
  );

  return R.route(pr.method, pathname, handler);
}

/**
 * Safely imports a module and returns its exports.
 *
 * @since 0.1.0
 */
export const safe_import = E.tryCatch(
  async (path: string): Promise<Record<string, unknown>> => {
    const result = await import(path);
    if (Ref.isRecord(result)) {
      return result;
    }
    throw new Error("Import did not return a record type.");
  },
  (error, [path]) =>
    route_build_error("Unable to import file.", { error, path }),
);

/**
 * Builds server routes from a file entry.
 *
 * @since 0.1.0
 */
export function build_server_routes<D>(
  entry: FileEntry,
  config: SiteConfig<D>,
): E.Effect<[], Err.AnyErr, O.Option<SiteRoutes<D>>> {
  const extensions = config.server_extensions ?? DEFAULT_SERVER_EXTENSIONS;

  return E.getsEither(async () => {
    // Check extension
    if (!extensions.includes(entry.extension)) {
      return Either.right(O.none);
    }

    // Parse pathname from relative path
    const pathname = parse_path(entry.relative_path, extensions);

    // Import the module
    const import_result = await safe_import(entry.absolute_path);
    const [either_exports] = import_result;

    if (either_exports.tag === "Left") {
      return either_exports;
    }

    const exports = either_exports.right;

    // Find all PartialRoute exports
    const partial_routes = pipe(
      exports,
      Rec.entries,
      A.filter(([_, value]) => is_partial_route(value)),
      A.map(([_, pr]) => pr as PartialRoute<D>),
    );

    if (partial_routes.length === 0) {
      return Either.right(O.none);
    }

    // Convert to server routes
    const server_routes = partial_routes.map((pr) =>
      server_route(
        entry.absolute_path,
        from_partial_route(pathname, pr),
      )
    );

    return Either.right(O.some(site_routes({ server_routes })));
  });
}

/**
 * Builds static routes from a file entry.
 *
 * @since 0.1.0
 */
export function build_static_routes<D>(
  entry: FileEntry,
  _config: SiteConfig<D>,
): E.Effect<[], Err.AnyErr, O.Option<SiteRoutes<D>>> {
  return E.gets(() => {
    const pathname = "/" + entry.relative_path;

    const route: R.Route<D> = R.route(
      "GET",
      pathname,
      E.tryCatch(
        async () => {
          const stream = await entry.stream();
          const headers: [string, string][] = [];

          pipe(
            entry.mime_type,
            O.match(
              () => {},
              (mime) => {
                headers.push(["Content-Type", mime]);
              },
            ),
          );

          return new Response(stream, { headers });
        },
        () =>
          R.text(
            `Unable to read file ${entry.filename}.`,
            R.STATUS_CODE.InternalServerError,
          ),
      ),
    );

    return O.some(
      site_routes<D>({
        static_routes: [static_route(entry.absolute_path, route as R.Route)],
      }),
    );
  });
}

/**
 * Creates a handler that serves index.html from the given path.
 *
 * @since 0.1.0
 */
function create_index_html_handler<D>(
  config: SiteConfig<D>,
  index_html_path: string,
): R.Handler<D> {
  return E.tryCatch(
    async () => {
      const stream = await config.tools.read_stream(index_html_path);
      return new Response(stream, {
        headers: [["Content-Type", "text/html; charset=utf-8"]],
      });
    },
    () =>
      R.text(
        "Unable to serve index.html",
        R.STATUS_CODE.InternalServerError,
      ),
  );
}

/**
 * Builds client routes from a file entry.
 *
 * When a client_root is exported from an index.ts file, this creates
 * routes for both `/` and `/index.html` to serve the SPA.
 *
 * @since 0.1.0
 */
export function build_client_routes<D>(
  entry: FileEntry,
  config: SiteConfig<D>,
  index_html_path: string,
): E.Effect<[], Err.AnyErr, O.Option<SiteRoutes<D>>> {
  const extensions = config.client_extensions ?? DEFAULT_CLIENT_EXTENSIONS;

  return E.getsEither(async () => {
    // Check extension
    if (!extensions.includes(entry.extension)) {
      return Either.right(O.none);
    }

    // Import the module
    const import_result = await safe_import(entry.absolute_path);
    const [either_exports] = import_result;

    if (either_exports.tag === "Left") {
      // Not a valid module, skip
      return Either.right(O.none);
    }

    const exports = either_exports.right;

    // Check for client_root export (SPA entry point)
    if ("client" in exports && is_client_root(exports.client)) {
      // Parse pathname
      const pathname = parse_path(entry.relative_path, extensions);
      const handler = create_index_html_handler(config, index_html_path);
      const routes: ClientRoute[] = [];

      // If this is an index file, create routes for / and /index.html
      if (entry.filename === "index.ts" || entry.filename === "index.tsx") {
        // Get the directory path (remove /index from pathname)
        const dir_path = pathname.endsWith("/index")
          ? pathname.slice(0, -6) || "/"
          : pathname;

        // Route for the directory root
        routes.push(
          client_route(
            entry.absolute_path,
            R.route("GET", dir_path, handler) as R.Route,
          ),
        );

        // Route for /index.html
        const index_html_route = dir_path === "/"
          ? "/index.html"
          : `${dir_path}/index.html`;
        routes.push(
          client_route(
            entry.absolute_path,
            R.route("GET", index_html_route, handler) as R.Route,
          ),
        );
      } else {
        // Non-index client root, just create the single route
        routes.push(
          client_route(
            entry.absolute_path,
            R.route("GET", pathname, handler) as R.Route,
          ),
        );
      }

      return Either.right(O.some(site_routes<D>({ client_routes: routes })));
    }

    // Check for default export of client_redirect
    if ("default" in exports && is_client_redirect(exports.default)) {
      // Parse pathname
      const pathname = parse_path(entry.relative_path, extensions);
      const handler = create_index_html_handler(config, index_html_path);

      const route = R.route<D>("GET", pathname, handler);

      return Either.right(
        O.some(
          site_routes<D>({
            client_routes: [
              client_route(entry.absolute_path, route as R.Route),
            ],
          }),
        ),
      );
    }

    return Either.right(O.none);
  });
}

/**
 * Route registry for detecting conflicts.
 *
 * @since 0.1.0
 */
type RouteRegistry = Map<string, { path: string; specificity: number }>;

/**
 * Checks for route conflicts and returns an error if found.
 *
 * @since 0.1.0
 */
export function check_conflicts<D>(
  routes: SiteRoutes<D>,
): Either.Either<Err.AnyErr, SiteRoutes<D>> {
  const registry: RouteRegistry = new Map();

  const all_routes = [
    ...routes.server_routes.map((r) => ({ ...r, phase: "server" })),
    ...routes.static_routes.map((r) => ({ ...r, phase: "static" })),
    ...routes.client_routes.map((r) => ({ ...r, phase: "client" })),
  ];

  for (const tagged of all_routes) {
    const key = `${tagged.route.method} ${tagged.route.pathname}`;
    const specificity = count_params(tagged.route.pathname);
    const existing = registry.get(key);

    if (existing && existing.specificity === specificity) {
      return Either.left(
        route_conflict_error(
          `Route conflict: "${key}" defined in both ${existing.path} and ${tagged.absolute_path}`,
          { existing: existing.path, conflict: tagged.absolute_path },
        ),
      );
    }

    registry.set(key, { path: tagged.absolute_path, specificity });
  }

  return Either.right(routes);
}

/**
 * Result of building a site.
 *
 * @since 0.1.0
 */
export type SiteBuilder<D = unknown> = R.Router & {
  readonly site_config: SiteConfig<D>;
  readonly site_routes: SiteRoutes<D>;
};

/**
 * Builds a site from a directory.
 *
 * @example
 * ```ts
 * import * as B from "pick/builder";
 * import { deno_tools } from "pick/platforms/deno";
 *
 * const result = await B.build_site({
 *   root_path: "./routes",
 *   tools: deno_tools(),
 *   state: { db: my_database },
 * });
 *
 * if (result.tag === "Right") {
 *   Deno.serve(result.right.handle);
 * }
 * ```
 *
 * @since 0.1.0
 */
export async function build_site<D>(
  config: SiteConfig<D>,
): Promise<Either.Either<Err.AnyErr, SiteBuilder<D>>> {
  const { root_path, tools, state, middlewares = [] } = config;
  const { combine } = get_initializable_site_routes<D>();

  let routes = site_routes<D>();

  // Walk directory and build routes
  const entries = tools.walk(root_path);

  for await (const entry of entries) {
    if (!entry.is_file) {
      continue;
    }

    tools.logger.debug("Processing file", entry.path);

    // Create FileEntry
    const file_entry_obj = file_entry(
      entry.path,
      tools.relative(root_path, entry.path),
      tools.basename(entry.path),
      tools.extname(entry.path),
      tools.mime_type(tools.extname(entry.path)),
      () => tools.read_stream(entry.path),
    );

    // Try server routes first
    const server_effect = build_server_routes(file_entry_obj, config);
    const [server_result] = await server_effect();
    if (server_result.tag === "Left") {
      return server_result;
    }
    if (server_result.right.tag === "Some") {
      routes = combine(routes)(server_result.right.value);
      continue; // File handled as server route
    }

    // Then client routes (if index_html_path is configured)
    if (config.index_html_path) {
      const client_effect = build_client_routes(
        file_entry_obj,
        config,
        config.index_html_path,
      );
      const [client_result] = await client_effect();
      if (client_result.tag === "Left") {
        return client_result;
      }
      if (client_result.right.tag === "Some") {
        routes = combine(routes)(client_result.right.value);
        continue; // File handled as client route
      }
    }

    // Then static routes (for non-TS files)
    const server_extensions = config.server_extensions ??
      DEFAULT_SERVER_EXTENSIONS;
    const client_extensions = config.client_extensions ??
      DEFAULT_CLIENT_EXTENSIONS;
    const all_code_extensions = [
      ...new Set([...server_extensions, ...client_extensions]),
    ];

    if (!all_code_extensions.includes(file_entry_obj.extension)) {
      const static_effect = build_static_routes(file_entry_obj, config);
      const [static_result] = await static_effect();
      if (static_result.tag === "Left") {
        return static_result;
      }
      if (static_result.right.tag === "Some") {
        routes = combine(routes)(static_result.right.value);
      }
    }
  }

  // Check for conflicts
  const conflict_check = check_conflicts(routes);
  if (conflict_check.tag === "Left") {
    return conflict_check;
  }

  // Build router
  const ctx = R.context(state, tools.logger);
  const { handle } = R.router(ctx, {
    routes: from_site_routes(routes),
    middlewares: middlewares as R.Middleware<D>[],
  });

  return Either.right({
    site_config: config,
    site_routes: routes,
    handle,
  });
}
