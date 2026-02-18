/**
 * Directory-based router builder for web applications.
 *
 * This module provides a builder that walks a directory structure and
 * creates routes for server endpoints, client SPA pages, and static assets.
 *
 * @module
 * @since 0.1.0
 */

import type { Decoded, Decoder } from "fun/decoder";
import type { Schema } from "fun/schemable";
import type { FunctionComponent } from "preact";

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

import { walk } from "@std/fs";
import { contentType } from "@std/media-types";
import { basename, extname, relative } from "@std/path";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";
import { Project, ts } from "@ts-morph/ts-morph";
import { renderToString } from "preact-render-to-string";

import * as R from "./router.ts";
import { DEFAULT_LOGGER, type Logger } from "./router.ts";
import {
  type ClientPage,
  type IndexPage,
  type IndexPageParameters,
  is_client_page,
  is_index_page,
  is_partial_route,
  type PartialRoute,
} from "./tokens.ts";

// Re-export tokens for convenience
export {
  client_page,
  type ClientPage,
  index_page,
  type IndexPage,
  type IndexPageParameters,
  is_client_page,
  is_index_page,
  is_partial_route,
  partial_route,
  type PartialRoute,
  type PartialRouteConfig,
} from "./tokens.ts";

// #region Error Types

/**
 * Error type for route building failures.
 *
 * @since 0.1.0
 */
export const route_build_error: Err.ErrFactory<"RouteBuildError"> = Err.err(
  "RouteBuildError",
);

/**
 * Error type for route conflicts.
 *
 * @since 0.1.0
 */
export const route_conflict_error: Err.ErrFactory<"RouteConflictError"> = Err
  .err("RouteConflictError");

/**
 * Error type for client bundle failures.
 *
 * @since 0.1.0
 */
export const client_bundle_error: Err.ErrFactory<"ClientBundleError"> = Err.err(
  "ClientBundleError",
);

/**
 * Error type for bundler failures.
 *
 * @since 0.3.0
 */
export const bundler_error: Err.ErrFactory<"BundlerError"> = Err.err(
  "BundlerError",
);

/**
 * Error type for file system operations.
 *
 * @since 0.3.0
 */
export const fs_error: Err.ErrFactory<"FsError"> = Err.err("FsError");

/**
 * Error type for code generation failures.
 *
 * @since 0.3.0
 */
export const codegen_error: Err.ErrFactory<"CodegenError"> = Err.err(
  "CodegenError",
);

// #endregion

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

// #endregion

// #region File Entry Types

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

// #endregion

// #region Path Utilities

/**
 * Parses a filesystem path into a URLPattern-compatible pathname.
 *
 * Handles:
 * - `:param/` directories -> `:param` segments
 * - `*.ts` -> `*` wildcard
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

// #endregion

// #region Tagged Routes

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

// #endregion

// #region Internal Tools

/**
 * Gets the mime type for a file extension using @std/media-types.
 *
 * @since 0.3.0
 */
function get_mime_type(extension: string): O.Option<string> {
  const mime = contentType(extension);
  return pipe(mime, O.fromNullable);
}

/**
 * Creates a readable stream for a file.
 *
 * @since 0.3.0
 */
async function read_stream(path: string): Promise<ReadableStream<Uint8Array>> {
  const file = await Deno.open(path, { read: true });
  return file.readable;
}

/**
 * Walks a directory and yields WalkEntry objects.
 *
 * @since 0.3.0
 */
async function* walk_directory(path: string): AsyncIterable<WalkEntry> {
  for await (const entry of walk(path)) {
    yield {
      is_file: entry.isFile,
      is_directory: entry.isDirectory,
      is_symlink: entry.isSymlink,
      name: entry.name,
      path: entry.path,
    };
  }
}

/**
 * Wraps an async operation that may throw in Either.tryCatch.
 *
 * @since 0.3.0
 */
const try_async = <A, C>(
  f: () => Promise<A>,
  onError: (error: unknown) => Err.Err<string, C>,
): Promise<Either.Either<Err.Err<string, C>, A>> =>
  f().then(Either.right).catch((error) => Either.left(onError(error)));

// #endregion

// #region Client Build Types

/**
 * Configuration for client builds using esbuild.
 *
 * @since 0.3.0
 */
export type ClientConfig = {
  /** Enable client SPA building (default: false) */
  readonly enabled?: boolean;
  /** App title for index.html */
  readonly title?: string;
  /** JSX transformation mode */
  readonly jsx?: "transform" | "preserve" | "automatic";
  /** JSX import source (default: "preact") */
  readonly jsxImportSource?: string;
  /** Enable tree shaking (default: true) */
  readonly treeShaking?: boolean;
  /** Minify the output (default: true) */
  readonly minify?: boolean;
  /** Generate source maps (default: true) */
  readonly sourcemap?: boolean | "inline" | "external";
  /** Enable code splitting (default: false) */
  readonly splitting?: boolean;
  /** Target environments (default: ["es2020"]) */
  readonly target?: string[];
  /** Path to deno.json for import map resolution */
  readonly configPath?: string;
};

/**
 * Entry representing a detected client page during directory walk.
 *
 * @since 0.3.0
 */
export type ClientPageEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly pathname: string;
  readonly title: string;
  readonly componentAlias: string;
  readonly componentExportName: string;
};

/**
 * Special files detected during directory walk.
 *
 * @since 0.3.0
 */
export type SpecialFiles = {
  readonly root: { absolutePath: string } | null;
  readonly indexPage: IndexPage | null;
  readonly notFound: { absolutePath: string } | null;
};

/**
 * Result of client build phase.
 *
 * @since 0.3.0
 */
export type ClientBuildResult = {
  readonly generatedAppPath: string;
  readonly bundleResult: BundleResult;
  readonly indexHtml: string;
};

// #endregion

// #region Site Configuration

/**
 * Configuration for the site builder.
 *
 * @since 0.1.0
 */
export type SiteConfig<D = unknown> = {
  readonly root_path: string;
  readonly state: D;
  readonly logger?: Logger;
  readonly middlewares?: readonly R.Middleware<D>[];
  readonly server_extensions?: readonly string[];
  readonly static_ignore?: readonly string[];
  /** Client SPA configuration */
  readonly client?: ClientConfig;
};

const DEFAULT_SERVER_EXTENSIONS = [".ts"] as const;
const DEFAULT_CLIENT_EXTENSIONS = [".ts", ".tsx"] as const;

// #endregion

// #region Bundler

/**
 * Bundles client code using esbuild with Deno + Preact configuration.
 *
 * @since 0.3.0
 */
function bundle_client(
  entrypoint: string,
  config: ClientConfig,
): Promise<Either.Either<Err.AnyErr, BundleResult>> {
  const {
    minify = true,
    treeShaking = true,
    sourcemap = true,
    splitting = false,
    target = ["es2020"],
    jsx = "automatic",
    jsxImportSource = "preact",
    configPath,
  } = config;

  const entrypointDir = entrypoint.substring(0, entrypoint.lastIndexOf("/"));

  return try_async(
    async () => {
      const result = await esbuild.build({
        entryPoints: [entrypoint],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        treeShaking,
        minify,
        sourcemap,
        splitting,
        target,
        outbase: entrypointDir,
        outdir: "/",
        jsx,
        jsxImportSource,
        entryNames: "[dir]/[name].[hash]",
        chunkNames: "[name].[hash]",
        assetNames: "[name].[hash]",
        plugins: denoPlugins({ configPath }) as esbuild.Plugin[],
      });

      const files: OutputFile[] = result.outputFiles?.map((file) => ({
        path: file.path.startsWith("/") ? file.path : `/${file.path}`,
        contents: file.contents,
      })) ?? [];

      return { files };
    },
    (error) => bundler_error("Failed to bundle client", { error, entrypoint }),
  );
}

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

      if (Either.isLeft(decode_result)) {
        return Either.left(
          R.json(
            JSON.stringify({
              error: "Invalid path parameters",
              details: D.draw(decode_result.left),
            }),
            R.STATUS_CODE.BadRequest,
          ),
        );
      }

      const decoded_pattern: URLPatternResult = {
        ...pattern,
        pathname: {
          ...pattern.pathname,
          groups: decode_result.right as Record<string, string | undefined>,
        },
      };
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
export const safe_import: E.Effect<
  [string],
  Err.Err<"RouteBuildError", { error: unknown; path: string }>,
  Record<string, unknown>
> = E.tryCatch(
  async (path: string): Promise<Record<string, unknown>> => {
    const file_url = path.startsWith("file://") ? path : `file://${path}`;
    const result = await import(file_url);
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
    if (!extensions.includes(entry.extension)) {
      return Either.right(O.none);
    }

    const pathname = parse_path(entry.relative_path, extensions);
    const [either_exports] = await safe_import(entry.absolute_path);

    return pipe(
      either_exports,
      Either.flatmap((exports) => {
        const partial_routes = pipe(
          exports,
          Rec.entries,
          A.filter(([_, value]) => is_partial_route(value)),
          A.map(([_, pr]) => pr as PartialRoute<D>),
        );

        if (partial_routes.length === 0) {
          return Either.right(O.none);
        }

        const server_routes = partial_routes.map((pr) =>
          server_route(entry.absolute_path, from_partial_route(pathname, pr))
        );

        return Either.right(O.some(site_routes({ server_routes })));
      }),
    );
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
          const headers: [string, string][] = pipe(
            entry.mime_type,
            O.match(
              () => [],
              (mime) => [["Content-Type", mime] as [string, string]],
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
    const headers: [string, string][] = pipe(
      mime_type,
      O.match(
        () => [],
        (mime) => [["Content-Type", mime] as [string, string]],
      ),
    );
    headers.push(["Cache-Control", "public, max-age=31536000, immutable"]);
    return new Response(asset, { headers });
  });
}

// #endregion

// #region Client Page Detection

/**
 * Find the export name of a value by object equality.
 *
 * @since 0.3.0
 */
export function findExportNameByEquality(
  exports: Record<string, unknown>,
  target: unknown,
): O.Option<string> {
  for (const [name, value] of Object.entries(exports)) {
    if (value === target) {
      return O.some(name);
    }
  }
  return O.none;
}

/**
 * Generate a PascalCase alias from a pathname.
 *
 * @since 0.3.0
 */
export function generateComponentAlias(pathname: string): string {
  const parts = pathname
    .split(/[\/:]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1));

  return parts.length === 0 ? "IndexPage" : parts.join("") + "Page";
}

/**
 * Detects a client page from a file entry.
 *
 * @since 0.3.0
 */
export async function detectClientPage(
  entry: FileEntry,
  extensions: readonly string[],
): Promise<Either.Either<Err.AnyErr, O.Option<ClientPageEntry>>> {
  if (!extensions.includes(entry.extension)) {
    return Either.right(O.none);
  }

  const filename = entry.filename;
  if (
    filename === "_root.tsx" ||
    filename === "_index.tsx" ||
    filename === "_404.tsx"
  ) {
    return Either.right(O.none);
  }

  const [result] = await safe_import(entry.absolute_path);

  if (Either.isLeft(result)) {
    return Either.right(O.none);
  }

  const exports = result.right;

  if (!("default" in exports) || !is_client_page(exports.default)) {
    return Either.right(O.none);
  }

  const clientPage = exports.default as ClientPage;
  const componentExportName = findExportNameByEquality(
    exports,
    clientPage.component,
  );

  return pipe(
    componentExportName,
    O.match(
      () =>
        Either.left(
          route_build_error(
            "client_page component must be exported from the same module",
            { path: entry.absolute_path },
          ),
        ),
      (exportName) => {
        const pathname = parse_path(entry.relative_path, extensions);
        const componentAlias = generateComponentAlias(pathname);

        return Either.right(
          O.some({
            absolutePath: entry.absolute_path,
            relativePath: entry.relative_path,
            pathname,
            title: clientPage.title,
            componentAlias,
            componentExportName: exportName,
          }),
        );
      },
    ),
  );
}

/**
 * Detects special files (_root.tsx, _index.tsx, _404.tsx).
 *
 * @since 0.3.0
 */
export async function detectSpecialFile(
  entry: FileEntry,
  specialFiles: SpecialFiles,
): Promise<SpecialFiles> {
  const filename = entry.filename;

  if (filename === "_root.tsx") {
    return { ...specialFiles, root: { absolutePath: entry.absolute_path } };
  }

  if (filename === "_index.tsx") {
    const [result] = await safe_import(entry.absolute_path);
    return pipe(
      result,
      Either.match(
        () => specialFiles,
        (exports) => {
          if ("default" in exports && is_index_page(exports.default)) {
            return { ...specialFiles, indexPage: exports.default };
          }
          return specialFiles;
        },
      ),
    );
  }

  if (filename === "_404.tsx") {
    return { ...specialFiles, notFound: { absolutePath: entry.absolute_path } };
  }

  return specialFiles;
}

// #endregion

// #region Code Generation

/**
 * Generates the client application code using ts-morph.
 *
 * @since 0.3.0
 */
export function generateClientApp(
  pages: ClientPageEntry[],
  specialFiles: SpecialFiles,
): Either.Either<Err.AnyErr, string> {
  try {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        jsxImportSource: "preact",
        esModuleInterop: true,
        strict: true,
      },
    });

    const sourceFile = project.createSourceFile("app.tsx");

    sourceFile.addImportDeclaration({
      moduleSpecifier: "preact-iso",
      namedImports: ["LocationProvider", "Router", "Route"],
    });

    sourceFile.addImportDeclaration({
      moduleSpecifier: "preact",
      namedImports: ["render"],
    });

    if (specialFiles.root) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: specialFiles.root.absolutePath,
        namedImports: ["Root"],
      });
    }

    if (specialFiles.notFound) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: specialFiles.notFound.absolutePath,
        namedImports: ["NotFound"],
      });
    }

    for (const page of pages) {
      sourceFile.addImportDeclaration({
        moduleSpecifier: page.absolutePath,
        namedImports: [{
          name: page.componentExportName,
          alias: page.componentAlias,
        }],
      });
    }

    const routes = pages
      .map((page) =>
        `<Route path="${page.pathname}" component={${page.componentAlias}} />`
      )
      .join("\n          ");

    sourceFile.addStatements(`
${!specialFiles.root ? "function Root({ children }) { return <>{children}</>; }" : ""}
${!specialFiles.notFound ? "function NotFound() { return <div><h1>404</h1><p>Page not found</p></div>; }" : ""}

function App() {
  return (
    <Root>
      <LocationProvider>
        <Router>
          ${routes}
          <Route default component={NotFound} />
        </Router>
      </LocationProvider>
    </Root>
  );
}

if (!document?.body) {
  throw new Error("No document or body to render application to!");
}

render(<App />, document.body);
`);

    sourceFile.formatText();
    return Either.right(sourceFile.getFullText());
  } catch (error) {
    return Either.left(
      codegen_error("Failed to generate client application code", { error }),
    );
  }
}

/**
 * Generates the index HTML using the index_page component.
 *
 * @since 0.3.0
 */
export function generateIndexHtml(
  indexPage: IndexPage | null,
  params: IndexPageParameters,
): Promise<Either.Either<Err.AnyErr, string>> {
  return try_async(
    async () => {
      const { h } = await import("preact");

      const DefaultComponent: FunctionComponent<IndexPageParameters> = ({
        scripts,
        styles,
        title,
      }) => {
        return h(
          "html",
          null,
          h(
            "head",
            null,
            h("meta", { charset: "utf-8" }),
            h("meta", {
              name: "viewport",
              content: "width=device-width, initial-scale=1",
            }),
            h("title", null, title),
            ...styles.map((href) => h("link", { rel: "stylesheet", href })),
          ),
          h(
            "body",
            null,
            ...scripts.map((src) => h("script", { type: "module", src })),
          ),
        );
      };

      const component = indexPage?.component ?? DefaultComponent;
      const vnode = h(component, params);
      return "<!DOCTYPE html>" + renderToString(vnode);
    },
    (error) => codegen_error("Failed to generate index HTML", { error }),
  );
}

// #endregion

// #region Route Conflict Detection

/**
 * Route conflict information.
 *
 * @since 0.3.0
 */
export type RouteConflict = {
  readonly path: string;
  readonly method: string;
  readonly sources: readonly string[];
};

/**
 * Detects route conflicts between server routes and client pages.
 *
 * @since 0.3.0
 */
export function detectRouteConflicts(
  serverRoutes: ServerRoute<unknown>[],
  clientPages: ClientPageEntry[],
): RouteConflict[] {
  const conflicts: RouteConflict[] = [];
  const getRoutes = new Map<string, string[]>();

  for (const route of serverRoutes) {
    if (route.route.method === "GET") {
      const sources = getRoutes.get(route.route.pathname) ?? [];
      sources.push(route.absolute_path);
      getRoutes.set(route.route.pathname, sources);
    }
  }

  for (const page of clientPages) {
    const sources = getRoutes.get(page.pathname);
    if (sources) {
      conflicts.push({
        path: page.pathname,
        method: "GET",
        sources: [...sources, page.absolutePath],
      });
    }
  }

  for (const [pathname, sources] of getRoutes) {
    if (sources.length > 1) {
      conflicts.push({ path: pathname, method: "GET", sources });
    }
  }

  return conflicts;
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

// #endregion

// #region Client Build Process

/**
 * Builds the client application.
 *
 * @since 0.3.0
 */
export async function buildClientApplication(
  pages: ClientPageEntry[],
  specialFiles: SpecialFiles,
  clientConfig: ClientConfig,
): Promise<Either.Either<Err.AnyErr, ClientBuildResult>> {
  // Generate application code
  const appCodeResult = generateClientApp(pages, specialFiles);
  if (Either.isLeft(appCodeResult)) {
    return appCodeResult;
  }
  const appCode = appCodeResult.right;

  // Create temp file
  const tempFileResult = await try_async(
    () => Deno.makeTempFile({ suffix: ".tsx" }),
    (error) => fs_error("Failed to create temp file", { error }),
  );
  if (Either.isLeft(tempFileResult)) {
    return tempFileResult;
  }
  const tempPath = tempFileResult.right;

  // Write app code to temp file
  const writeResult = await try_async(
    () => Deno.writeTextFile(tempPath, appCode),
    (error) => fs_error("Failed to write app code to temp file", { error }),
  );
  if (Either.isLeft(writeResult)) {
    return writeResult;
  }

  // Bundle with esbuild
  const bundleResult = await bundle_client(tempPath, clientConfig);

  // Cleanup temp file (ignore errors)
  await Deno.remove(tempPath).catch(() => {});

  if (Either.isLeft(bundleResult)) {
    return bundleResult;
  }

  // Collect asset paths
  const scripts = bundleResult.right.files
    .filter((f) => f.path.endsWith(".js"))
    .map((f) => (f.path.startsWith("/") ? f.path : "/" + f.path));
  const styles = bundleResult.right.files
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => (f.path.startsWith("/") ? f.path : "/" + f.path));

  // Generate index HTML
  const indexHtmlResult = await generateIndexHtml(specialFiles.indexPage, {
    title: clientConfig.title ?? "App",
    scripts,
    styles,
  });

  if (Either.isLeft(indexHtmlResult)) {
    return indexHtmlResult;
  }

  return Either.right({
    generatedAppPath: tempPath,
    bundleResult: bundleResult.right,
    indexHtml: indexHtmlResult.right,
  });
}

/**
 * Creates routes from a client build result.
 *
 * @since 0.3.0
 */
export function createClientRoutes<D>(
  buildResult: ClientBuildResult,
): SiteRoutes<D> {
  const clientRoutes: ClientRoute[] = [];

  for (const file of buildResult.bundleResult.files) {
    const ext = extname(file.path);
    const mimeType = get_mime_type(ext);
    const handler = create_asset_handler<D>(file.contents, mimeType);
    const pathname = file.path.startsWith("/") ? file.path : "/" + file.path;
    clientRoutes.push(
      client_route(
        buildResult.generatedAppPath,
        R.route("GET", pathname, handler) as R.Route,
        "client_asset_builder",
      ),
    );
  }

  const htmlHandler = create_html_handler<D>(buildResult.indexHtml);

  clientRoutes.push(
    client_route(
      buildResult.generatedAppPath,
      R.route("GET", "/", htmlHandler) as R.Route,
    ),
  );
  clientRoutes.push(
    client_route(
      buildResult.generatedAppPath,
      R.route("GET", "/index.html", htmlHandler) as R.Route,
    ),
  );
  clientRoutes.push(
    client_route(
      buildResult.generatedAppPath,
      R.route("GET", "*", htmlHandler) as R.Route,
      "client_spa_fallback",
    ),
  );

  return site_routes<D>({ client_routes: clientRoutes });
}

// #endregion

// #region Build Result Types

/**
 * Metadata about the built site.
 *
 * @since 0.3.0
 */
export type SiteMetadata = {
  readonly root_path: string;
  readonly server_route_count: number;
  readonly static_route_count: number;
  readonly client_route_count: number;
  readonly client_pages: readonly ClientPageEntry[];
  readonly special_files: SpecialFiles;
};

/**
 * Client bundle information.
 *
 * @since 0.3.0
 */
export type ClientBundleInfo = {
  readonly enabled: boolean;
  readonly bundle_result: BundleResult | null;
  readonly index_html: string | null;
  readonly title: string;
};

/**
 * Result of building a site.
 *
 * @since 0.3.0
 */
export type SiteBuildResult<D = unknown> = {
  readonly config: SiteConfig<D>;
  readonly routes: R.Route<D>[];
  readonly site_routes: SiteRoutes<D>;
  readonly metadata: SiteMetadata;
  readonly client_bundle: ClientBundleInfo;
};

// #endregion

/**
 * Builds a site from a directory.
 *
 * Returns route information, metadata, and bundle data without initializing
 * a router. Use `R.router()` to create a router from the returned routes.
 *
 * @example
 * ```ts
 * import * as B from "pick/builder";
 * import * as R from "pick/router";
 *
 * const result = await B.build_site({
 *   root_path: "./routes",
 *   state: { db: my_database },
 *   client: {
 *     enabled: true,
 *     title: "My App",
 *   },
 * });
 *
 * if (Either.isRight(result)) {
 *   const ctx = R.context(result.right.config.state);
 *   const { handle } = R.router(ctx, { routes: result.right.routes });
 *   Deno.serve(handle);
 * }
 * ```
 *
 * @since 0.1.0
 */
export async function build_site<D>(
  config: SiteConfig<D>,
): Promise<Either.Either<Err.AnyErr, SiteBuildResult<D>>> {
  const { root_path, client } = config;
  const logger = config.logger ?? DEFAULT_LOGGER;
  const { combine } = get_initializable_site_routes<D>();

  let routes = site_routes<D>();

  const clientPages: ClientPageEntry[] = [];
  let specialFiles: SpecialFiles = {
    root: null,
    indexPage: null,
    notFound: null,
  };

  const clientEnabled = client?.enabled ?? false;
  const clientExtensions = DEFAULT_CLIENT_EXTENSIONS;

  // Phase 1: Walk directory and build routes
  const entries = walk_directory(root_path);

  for await (const entry of entries) {
    if (!entry.is_file) {
      continue;
    }

    logger.debug("Processing file", entry.path);

    const ext = extname(entry.path);
    const file_entry_obj = file_entry(
      entry.path,
      relative(root_path, entry.path),
      basename(entry.path),
      ext,
      get_mime_type(ext),
      () => read_stream(entry.path),
    );

    // Try server routes first
    const [server_result] = await build_server_routes(file_entry_obj, config)();

    if (Either.isLeft(server_result)) {
      return server_result;
    }

    if (O.isSome(server_result.right)) {
      routes = combine(routes)(server_result.right.value);
      continue;
    }

    // Check for client pages if client is enabled
    if (
      clientEnabled &&
      (clientExtensions as readonly string[]).includes(file_entry_obj.extension)
    ) {
      specialFiles = await detectSpecialFile(file_entry_obj, specialFiles);

      const clientPageResult = await detectClientPage(
        file_entry_obj,
        clientExtensions,
      );

      if (Either.isLeft(clientPageResult)) {
        return clientPageResult;
      }

      if (O.isSome(clientPageResult.right)) {
        clientPages.push(clientPageResult.right.value);
        logger.debug(
          "Detected client page",
          clientPageResult.right.value.pathname,
        );
        continue;
      }
    }

    // Then static routes (for non-code files)
    const server_extensions =
      config.server_extensions ?? DEFAULT_SERVER_EXTENSIONS;
    const all_code_extensions = clientEnabled
      ? [...new Set([...server_extensions, ...clientExtensions])]
      : server_extensions;

    if (!all_code_extensions.includes(file_entry_obj.extension)) {
      const [static_result] = await build_static_routes(
        file_entry_obj,
        config,
      )();

      if (Either.isLeft(static_result)) {
        return static_result;
      }

      if (O.isSome(static_result.right)) {
        routes = combine(routes)(static_result.right.value);
      }
    }
  }

  // Phase 2: Build client application if enabled
  let clientBundleInfo: ClientBundleInfo = {
    enabled: clientEnabled,
    bundle_result: null,
    index_html: null,
    title: client?.title ?? "App",
  };

  if (clientEnabled && client && clientPages.length > 0) {
    logger.info(
      `Building client application with ${clientPages.length} page(s)...`,
    );

    const conflicts = detectRouteConflicts(
      routes.server_routes as ServerRoute<unknown>[],
      clientPages,
    );

    if (conflicts.length > 0) {
      const conflict = conflicts[0];
      return Either.left(
        route_conflict_error(
          `Route conflict: "${conflict.method} ${conflict.path}" defined in multiple files`,
          { sources: conflict.sources },
        ),
      );
    }

    const buildResult = await buildClientApplication(
      clientPages,
      specialFiles,
      client,
    );

    if (Either.isLeft(buildResult)) {
      return buildResult;
    }

    const clientRoutes = createClientRoutes<D>(buildResult.right);
    routes = combine(routes)(clientRoutes);

    clientBundleInfo = {
      enabled: true,
      bundle_result: buildResult.right.bundleResult,
      index_html: buildResult.right.indexHtml,
      title: client.title ?? "App",
    };

    logger.info(`Client application built successfully`);
  }

  // Check for conflicts
  const conflict_check = check_conflicts(routes);
  if (Either.isLeft(conflict_check)) {
    return conflict_check;
  }

  const metadata: SiteMetadata = {
    root_path,
    server_route_count: routes.server_routes.length,
    static_route_count: routes.static_routes.length,
    client_route_count: routes.client_routes.length,
    client_pages: clientPages,
    special_files: specialFiles,
  };

  return Either.right({
    config,
    routes: from_site_routes(routes),
    site_routes: routes,
    metadata,
    client_bundle: clientBundleInfo,
  });
}
