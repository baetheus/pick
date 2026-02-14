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

const PartialRouteSymbol = "PARTIAL_ROUTE" as const;
type PartialRouteSymbol = typeof PartialRouteSymbol;

const ClientRedirectSymbol = "CLIENT_REDIRECT" as const;
type ClientRedirectSymbol = typeof ClientRedirectSymbol;

const ClientRootSymbol = "CLIENT_ROOT" as const;
type ClientRootSymbol = typeof ClientRootSymbol;

// #region Bundler Interface

/**
 * Represents an output file from the bundler.
 *
 * @since 0.1.0
 */
export type OutputFile = {
  readonly path: string;
  readonly contents: Uint8Array;
};

/**
 * Result of a bundle operation.
 *
 * @since 0.1.0
 */
export type BundleResult = {
  readonly files: readonly OutputFile[];
};

/**
 * Bundler function type that takes an entrypoint and returns bundled files.
 *
 * @since 0.1.0
 */
export type Bundler = (
  entrypoint: string,
) => Promise<Either.Either<Err.AnyErr, BundleResult>>;

/**
 * Configuration passed to the client index creator function.
 *
 * @since 0.1.0
 */
export type ClientIndexConfig = {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly baseUrl: string;
};

/**
 * Function type for creating the HTML index for a client root.
 *
 * @since 0.1.0
 */
export type ClientIndexCreator = (config: ClientIndexConfig) => string;

// #endregion

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
 * Files with this as default export redirect to a specific client root.
 *
 * @since 0.1.0
 */
export type ClientRedirect = {
  readonly type: ClientRedirectSymbol;
  readonly target: ClientRoot;
};

/**
 * Creates a client redirect that points to a specific client root.
 *
 * @example
 * ```ts
 * // In a client route file
 * import clientRoot from "./client.tsx";
 * export default client_redirect(clientRoot);
 * ```
 *
 * @since 0.1.0
 */
export function client_redirect(target: ClientRoot): ClientRedirect {
  return { type: ClientRedirectSymbol, target };
}

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
  readonly createIndex: ClientIndexCreator;
};

/**
 * Creates a client root marker for SPA entry points.
 *
 * @example
 * ```tsx
 * // In client.tsx (must be default export)
 * export default client_root(({ scripts, styles, baseUrl }) => `
 * <!DOCTYPE html>
 * <html>
 * <head>
 *   <base href="${baseUrl}">
 *   ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join("")}
 * </head>
 * <body>
 *   <div id="app"></div>
 *   ${scripts.map(s => `<script type="module" src="${s}"></script>`).join("")}
 * </body>
 * </html>
 * `);
 *
 * // Client-side code (bundled by esbuild)
 * if (typeof document !== "undefined") {
 *   render(<App />, document.getElementById("app")!);
 * }
 * ```
 *
 * @since 0.1.0
 */
export function client_root(createIndex: ClientIndexCreator): ClientRoot {
  return { type: ClientRootSymbol, createIndex };
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
  readonly bundler?: Bundler;
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

/**
 * Error type for client bundle failures.
 *
 * @since 0.1.0
 */
export const client_bundle_error = Err.err("ClientBundleError");

/**
 * Error type for client root not found.
 *
 * @since 0.1.0
 */
export const client_root_not_found_error = Err.err("ClientRootNotFoundError");

// #region Client Build Entries

/**
 * Entry representing a detected client root during directory walk.
 *
 * @since 0.1.0
 */
export type ClientRootEntry = {
  readonly absolute_path: string;
  readonly relative_path: string;
  readonly pathname: string;
  readonly client_root: ClientRoot;
};

/**
 * Entry representing a detected client redirect during directory walk.
 *
 * @since 0.1.0
 */
export type ClientRedirectEntry = {
  readonly absolute_path: string;
  readonly pathname: string;
  readonly target: ClientRoot;
};

/**
 * Map of client roots keyed by their ClientRoot reference.
 *
 * @since 0.1.0
 */
type ClientRootMap = Map<ClientRoot, ClientRootEntry>;

/**
 * Map of generated HTML content keyed by ClientRoot reference.
 *
 * @since 0.1.0
 */
type ClientHtmlMap = Map<ClientRoot, string>;

// #endregion

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
    // deno-lint-ignore: unanalyzable-dynamic-import
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
 * Creates a handler that serves pre-generated HTML content.
 *
 * @since 0.1.0
 */
function create_html_handler<D>(html_content: string): R.Handler<D> {
  return E.gets(() =>
    new Response(html_content, {
      headers: [["Content-Type", "text/html; charset=utf-8"]],
    })
  );
}

/**
 * Creates a handler that serves bundled asset content with caching headers.
 *
 * @since 0.1.0
 */
function create_asset_handler<D>(
  contents: Uint8Array,
  mime_type: O.Option<string>,
): R.Handler<D> {
  const decoder = new TextDecoder();
  const asset = decoder.decode(contents);
  return E.gets(() => {
    const headers: [string, string][] = [];
    pipe(
      mime_type,
      O.match(
        () => {},
        (mime) => {
          headers.push(["Content-Type", mime]);
        },
      ),
    );
    // Immutable caching enabled because content hash changes when file changes
    headers.push(["Cache-Control", "public, max-age=31536000, immutable"]);
    return new Response(asset, { headers });
  });
}

/**
 * Detects client root or redirect from a file entry during directory walk.
 *
 * @since 0.1.0
 */
export async function detect_client_entry<D>(
  entry: FileEntry,
  config: SiteConfig<D>,
): Promise<
  Either.Either<
    Err.AnyErr,
    O.Option<
      { type: "root"; entry: ClientRootEntry } | {
        type: "redirect";
        entry: ClientRedirectEntry;
      }
    >
  >
> {
  const extensions = config.client_extensions ?? DEFAULT_CLIENT_EXTENSIONS;

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

  // Check for default export of client_root (SPA entry point)
  if ("default" in exports && is_client_root(exports.default)) {
    const pathname = parse_path(entry.relative_path, extensions);
    return Either.right(
      O.some({
        type: "root" as const,
        entry: {
          absolute_path: entry.absolute_path,
          relative_path: entry.relative_path,
          pathname,
          client_root: exports.default,
        },
      }),
    );
  }

  // Check for default export of client_redirect
  if ("default" in exports && is_client_redirect(exports.default)) {
    const pathname = parse_path(entry.relative_path, extensions);
    return Either.right(
      O.some({
        type: "redirect" as const,
        entry: {
          absolute_path: entry.absolute_path,
          pathname,
          target: exports.default.target,
        },
      }),
    );
  }

  return Either.right(O.none);
}

/**
 * Builds client routes after bundling is complete.
 *
 * @since 0.1.0
 */
export async function build_client_routes_from_bundle<D>(
  client_root_entry: ClientRootEntry,
  bundle_result: BundleResult,
  tools: BuilderTools,
): Promise<Either.Either<Err.AnyErr, { routes: SiteRoutes<D>; html: string }>> {
  try {
    // Categorize output files into scripts and styles
    const scripts: string[] = [];
    const styles: string[] = [];
    const asset_routes: ClientRoute[] = [];

    for (const file of bundle_result.files) {
      const ext = tools.extname(file.path);
      const mime_type = tools.mime_type(ext);

      // Create route for this asset
      const handler = create_asset_handler<D>(file.contents, mime_type);
      asset_routes.push(
        client_route(
          client_root_entry.absolute_path,
          R.route("GET", file.path, handler) as R.Route,
          "client_asset_builder",
        ),
      );

      // Categorize for index generation
      if (ext === ".js" || ext === ".mjs") {
        scripts.push(file.path);
      } else if (ext === ".css") {
        styles.push(file.path);
      }
    }

    // Calculate base URL
    const pathname = client_root_entry.pathname;
    const baseUrl = pathname.endsWith("/index")
      ? pathname.slice(0, -6) || "/"
      : pathname;

    // Generate HTML using the client root's createIndex function
    const html = client_root_entry.client_root.createIndex({
      scripts,
      styles,
      baseUrl,
    });

    // Create HTML handler
    const html_handler = create_html_handler<D>(html);
    const html_routes: ClientRoute[] = [];

    // Determine the routes to create based on filename
    const filename = tools.basename(client_root_entry.absolute_path);
    if (
      filename === "index.ts" ||
      filename === "index.tsx" ||
      filename === "client.ts" ||
      filename === "client.tsx"
    ) {
      // Route for the directory root
      html_routes.push(
        client_route(
          client_root_entry.absolute_path,
          R.route("GET", baseUrl, html_handler) as R.Route,
        ),
      );

      // Route for /index.html
      const index_html_route = baseUrl === "/"
        ? "/index.html"
        : `${baseUrl}/index.html`;
      html_routes.push(
        client_route(
          client_root_entry.absolute_path,
          R.route("GET", index_html_route, html_handler) as R.Route,
        ),
      );
    } else {
      // Non-index client root, just create the single route
      html_routes.push(
        client_route(
          client_root_entry.absolute_path,
          R.route("GET", pathname, html_handler) as R.Route,
        ),
      );
    }

    return Either.right({
      routes: site_routes<D>({
        client_routes: [...asset_routes, ...html_routes],
      }),
      html,
    });
  } catch (error) {
    return Either.left(
      client_bundle_error("Failed to build client routes from bundle", {
        error,
        entrypoint: client_root_entry.absolute_path,
      }),
    );
  }
}

/**
 * Creates routes for client redirects.
 *
 * @since 0.1.0
 */
export function build_client_redirect_routes<D>(
  redirect_entry: ClientRedirectEntry,
  client_html_map: ClientHtmlMap,
): Either.Either<Err.AnyErr, SiteRoutes<D>> {
  const html = client_html_map.get(redirect_entry.target);

  if (html === undefined) {
    return Either.left(
      client_root_not_found_error(
        "Client redirect references a client root that was not found",
        { redirect_path: redirect_entry.absolute_path },
      ),
    );
  }

  const handler = create_html_handler<D>(html);
  const route = R.route<D>("GET", redirect_entry.pathname, handler);

  return Either.right(
    site_routes<D>({
      client_routes: [
        client_route(redirect_entry.absolute_path, route as R.Route),
      ],
    }),
  );
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
 * import { esbuild_deno_preact } from "pick/bundlers/esbuild-deno-preact";
 *
 * const result = await B.build_site({
 *   root_path: "./routes",
 *   tools: deno_tools(),
 *   state: { db: my_database },
 *   bundler: esbuild_deno_preact(),
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
  const { root_path, tools, state, middlewares = [], bundler } = config;
  const { combine } = get_initializable_site_routes<D>();

  let routes = site_routes<D>();

  // Collections for client build phase
  const client_roots: ClientRootMap = new Map();
  const client_redirects: ClientRedirectEntry[] = [];

  // Phase 1: Walk directory and build routes
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

    // Then check for client roots/redirects (if bundler is configured)
    if (bundler) {
      const client_detection = await detect_client_entry(
        file_entry_obj,
        config,
      );
      if (client_detection.tag === "Left") {
        return client_detection;
      }
      if (client_detection.right.tag === "Some") {
        const detected = client_detection.right.value;
        if (detected.type === "root") {
          client_roots.set(detected.entry.client_root, detected.entry);
          tools.logger.debug("Detected client root", detected.entry.pathname);
        } else {
          client_redirects.push(detected.entry);
          tools.logger.debug(
            "Detected client redirect",
            detected.entry.pathname,
          );
        }
        continue; // File handled as client entry
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

  // Phase 2: Bundle client roots and create routes
  const client_html_map: ClientHtmlMap = new Map();

  if (bundler && client_roots.size > 0) {
    tools.logger.info(`Bundling ${client_roots.size} client root(s)...`);

    for (const [client_root_ref, client_root_entry] of client_roots) {
      tools.logger.debug("Bundling", client_root_entry.absolute_path);

      // Bundle the client root
      const bundle_result = await bundler(client_root_entry.absolute_path);
      if (bundle_result.tag === "Left") {
        return bundle_result;
      }

      tools.logger.debug(
        `Bundle produced ${bundle_result.right.files.length} file(s)`,
      );

      // Build routes from bundle
      const client_routes_result = await build_client_routes_from_bundle<D>(
        client_root_entry,
        bundle_result.right,
        tools,
      );
      if (client_routes_result.tag === "Left") {
        return client_routes_result;
      }

      routes = combine(routes)(client_routes_result.right.routes);
      client_html_map.set(client_root_ref, client_routes_result.right.html);
    }
  }

  // Phase 3: Build client redirect routes
  for (const redirect_entry of client_redirects) {
    const redirect_result = build_client_redirect_routes<D>(
      redirect_entry,
      client_html_map,
    );
    if (redirect_result.tag === "Left") {
      return redirect_result;
    }
    routes = combine(routes)(redirect_result.right);
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
