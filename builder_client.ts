/**
 * Client SPA builder for preact-based single page applications.
 *
 * This module provides a builder that processes client-side route files
 * and generates a bundled SPA with client-side routing using preact-iso.
 *
 * @module
 * @since 0.3.0
 */

import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import * as Path from "@std/path";
import * as Refinement from "@baetheus/fun/refinement";
import { pipe } from "@baetheus/fun/fn";
import { contentType } from "@std/media-types";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";

import * as Builder from "./builder.ts";
import * as Router from "./router.ts";
import * as Tokens from "./tokens.ts";

const client_builder_error = Err.err("ClientBuilderError");

/**
 * Configuration options for the client SPA builder.
 *
 * Extends Deno.bundle.Options with additional options for controlling
 * the client build process.
 *
 * @example
 * ```ts
 * import type { ClientBuilderOptions } from "@baetheus/pick/builder_client";
 *
 * const options: ClientBuilderOptions = {
 *   name: "MySPABuilder",
 *   title: "My Application",
 *   include_extensions: [".tsx"],
 *   minify: true,
 * };
 * ```
 *
 * @since 0.3.0
 */
export type ClientBuilderOptions = {
  readonly name?: string;
  readonly title?: string;
  readonly include_extensions?: string[];
  readonly bundler_options?: Deno.bundle.Options;
};

type ClientRouteEntry<T extends string, P = unknown> = {
  readonly file_entry: Builder.FileEntry;
  readonly export_pair: [export_name: string, Tokens.ClientPage<T, P>];
};

type ClientBuilderState = {
  routes: ClientRouteEntry<"ClientRoute">[];
  default_routes: ClientRouteEntry<"ClientDefaultRoute">[];
  wrappers: ClientRouteEntry<"ClientWrapper", Tokens.ClientWrapperParameters>[];
  indices: ClientRouteEntry<"ClientIndex", Tokens.ClientIndexParameters>[];
};

function strip_extension(path: string): string {
  const parsed_path = Path.parse(Path.normalize(path));
  const stripped = Path.join(parsed_path.dir, parsed_path.name);
  return stripped;
}

function generateDefaultHtml(
  scripts: readonly string[],
  styles: readonly string[],
  title: string,
): string {
  const styleLinks = styles
    .map((s) => `  <link rel="stylesheet" href="${s}">`)
    .join("\n");
  const scriptTags = scripts
    .map((s) => `  <script type="module" src="${s}"></script>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
${styleLinks}
</head>
<body>
  <div id="app"></div>
${scriptTags}
</body>
</html>`;
}

const client_route_pair = Refinement.tuple(
  Refinement.string,
  Tokens.client_route.refine,
);
const client_default_pair = Refinement.tuple(
  Refinement.string,
  Tokens.client_default.refine,
);
const client_wrapper_pair = Refinement.tuple(
  Refinement.string,
  Tokens.client_wrapper.refine,
);
const client_index_pair = Refinement.tuple(
  Refinement.string,
  Tokens.client_index.refine,
);

// --- String Combinators for Code Generation ---

// Low-level string helpers
const join = (sep: string) => (items: string[]): string => items.join(sep);
const wrap = (prefix: string, suffix: string) => (content: string): string =>
  `${prefix}${content}${suffix}`;
const braces = wrap("{", "}");
const parens = wrap("(", ")");
const quoted = wrap('"', '"');

// List combinators
const commaList = join(", ");
const lineList = join("\n");

// Property access and calls
const prop = (obj: string, key: string): string => `${obj}.${key}`;
const call = (fn: string, ...args: string[]): string =>
  `${fn}${parens(commaList(args))}`;
const methodCall = (obj: string, method: string, ...args: string[]): string =>
  call(prop(obj, method), ...args);

// Expressions
const arrow = (params: string, body: string): string =>
  `${parens(params)} => ${body}`;
const arrowExpr = (body: string): string => arrow("", body);
const dynamicImport = (path: string): string => call("import", quoted(path));
const objectLiteral = (entries: [string, string][]): string =>
  braces(` ${commaList(entries.map(([k, v]) => `${k}: ${v}`))} `);

// Import combinators
const namedImport = (name: string): string => name;
const aliasedImport = (name: string, alias: string): string =>
  `${name} as ${alias}`;
const importList = (imports: string[]): string =>
  braces(` ${commaList(imports)} `);
const importDecl = (specifier: string, imports: string[]): string =>
  `import ${importList(imports)} from ${quoted(specifier)};`;

// Declaration combinators
const constDecl = (name: string, initializer: string): string =>
  `const ${name} = ${initializer};`;
const funcDecl = (name: string, body: string): string =>
  `function ${name}() { ${body} }`;
const returnStmt = (expr: string): string => `return ${expr};`;
const statement = (expr: string): string => `${expr};`;
// Preact-specific combinators
const hCall = (
  component: string,
  props: string,
  ...children: string[]
): string =>
  children.length > 0
    ? call("h", component, props, ...children)
    : call("h", component, props);

const lazyComponent = (path: string, exportName: string): string =>
  call(
    "lazy",
    arrowExpr(
      methodCall(
        dynamicImport(path),
        "then",
        arrow(
          "m",
          parens(
            objectLiteral([[
              "default",
              prop(prop("m", exportName), "component"),
            ]]),
          ),
        ),
      ),
    ),
  );

// Code generation functions
function genPreactImports(): string[] {
  return [
    importDecl("preact", ["h", "render", "Fragment"].map(namedImport)),
    importDecl(
      "preact-iso",
      [
        "LocationProvider",
        "Router",
        "Route",
        "ErrorBoundary",
        "lazy",
      ].map(namedImport),
    ),
  ];
}

function genWrapperImport(
  wrapper: ClientRouteEntry<"ClientWrapper", Tokens.ClientWrapperParameters>,
): string {
  return importDecl(
    wrapper.file_entry.absolute_path,
    [aliasedImport(wrapper.export_pair[0], "WrapperModule")],
  );
}

function genLazyRouteVariables(
  routes: ClientRouteEntry<"ClientRoute">[],
): string[] {
  return routes.map((route, index) =>
    constDecl(
      `Route${index}`,
      lazyComponent(route.file_entry.absolute_path, route.export_pair[0]),
    )
  );
}

function genDefaultRouteVariable(
  defaultRoute: ClientRouteEntry<"ClientDefaultRoute">,
): string {
  return constDecl(
    "DefaultRoute",
    lazyComponent(
      defaultRoute.file_entry.absolute_path,
      defaultRoute.export_pair[0],
    ),
  );
}

function genRouteElement(path: string, component: string): string {
  return hCall(
    "Route",
    objectLiteral([["path", quoted(path)], ["component", component]]),
  );
}

function genDefaultRouteElement(): string {
  return hCall(
    "Route",
    objectLiteral([
      ["path", quoted("/*")],
      ["component", "DefaultRoute"],
      ["default", "true"],
    ]),
  );
}

function genAppFunction(state: ClientBuilderState): string {
  const wrapperComponent = state.wrappers.length > 0
    ? prop("WrapperModule", "component")
    : "Fragment";

  const routeElements = state.routes.map((route, index) =>
    genRouteElement(
      strip_extension(route.file_entry.relative_path),
      `Route${index}`,
    )
  );

  if (state.default_routes.length > 0) {
    routeElements.push(genDefaultRouteElement());
  }

  const routerContent = hCall("Router", "null", ...routeElements);
  const errorBoundary = hCall("ErrorBoundary", "null", routerContent);
  const locationProvider = hCall("LocationProvider", "null", errorBoundary);
  const appBody = hCall(wrapperComponent, "null", locationProvider);

  return funcDecl("App", returnStmt(appBody));
}

function genRenderStatement(): string {
  return statement(call("render", call("App"), prop("document", "body")));
}

function generateEntrypointSource(state: ClientBuilderState): string {
  const lines: string[] = [];

  lines.push(...genPreactImports());

  if (state.wrappers.length > 0) {
    lines.push(genWrapperImport(state.wrappers[0]));
  }

  lines.push(...genLazyRouteVariables(state.routes));

  if (state.default_routes.length > 0) {
    lines.push(genDefaultRouteVariable(state.default_routes[0]));
  }

  lines.push(genAppFunction(state));
  lines.push(genRenderStatement());

  return lineList(lines);
}

function safe_bundle(
  bundle_options: Deno.bundle.Options,
): Builder.BuildEffect<Deno.bundle.Result> {
  return Effect.tryCatch(
    async (_) => await Deno.bundle(bundle_options),
    (err, config) =>
      client_builder_error("Deno.bundle threw an exception", {
        err,
        // deno-lint-ignore no-explicit-any
        test: (<any> err).message,
        config,
        bundle_options,
      }),
  );
}

function check_builder_state(
  state: ClientBuilderState,
): Builder.BuildEffect<ClientBuilderState> {
  if (state.default_routes.length > 1) {
    return Effect.left(
      client_builder_error(
        "Client builder supports a maximum of 1 default route",
        state,
      ),
    );
  }

  if (state.wrappers.length > 1) {
    return Effect.left(
      client_builder_error(
        "Client builder supports a maximum of 1 application wrapper",
        state,
      ),
    );
  }

  if (state.indices.length > 1) {
    return Effect.left(
      client_builder_error(
        "Client builder supports a maximum of 1 index creator",
        state,
      ),
    );
  }

  return Effect.right(state);
}

function create_entrypoint(
  state: ClientBuilderState,
): Builder.BuildEffect<string> {
  return Effect.gets(async (config) => {
    const tempFilePath = await config.fs.makeTempFile({
      prefix: "bundle-",
      suffix: ".ts",
    });
    const sourceText = generateEntrypointSource(state);
    const encoder = new TextEncoder();
    const sourceBytes = encoder.encode(sourceText);
    await config.fs.write(Path.parse(tempFilePath), sourceBytes);
    return tempFilePath;
  });
}

function create_bundle_assets(
  entrypoint: string,
  client_config: Deno.bundle.Options,
): Builder.BuildEffect<Map<string, Uint8Array>> {
  return pipe(
    safe_bundle({
      ...client_config,
      entrypoints: [entrypoint],
      write: false,
    }),
    Effect.flatmap((results) => {
      if (results.success) {
        const map = new Map<string, Uint8Array>();
        for (const file of results.outputFiles ?? []) {
          if (file.contents !== undefined) {
            map.set(
              file.path === "<stdout>" ? `bundle-${file.hash}.js` : file.path,
              file.contents,
            );
          }
        }
        return Effect.right(map);
      }
      return Effect.left(
        client_builder_error("Deno.bundle returned errors", {
          results,
          entrypoint,
        }),
      );
    }),
  );
}

function create_index_handler(
  bundle_assets: Map<string, Uint8Array>,
  state: ClientBuilderState,
  title: string,
): Builder.BuildEffect<Router.Handler> {
  const assets = Array.from(bundle_assets.keys());
  const scripts = assets.filter((path) => path.endsWith(".js"));
  const styles = assets.filter((path) => path.endsWith(".css"));
  let html: string;

  if (state.indices.length > 0) {
    const index = state.indices[0];
    const IndexComponent = index.export_pair[1].component;
    html = renderToString(h(IndexComponent, {
      title,
      scripts,
      styles,
    }));
  } else {
    html = generateDefaultHtml(scripts, styles, title);
  }
  return Effect.wrap(
    Effect.gets(() => Router.html(html)) as Router.Handler,
  );
}

function create_routes(
  config: Builder.BuildConfig,
  indexHandler: Router.Handler,
  state: ClientBuilderState,
  bundle_assets: Map<string, Uint8Array>,
  builder_name: string,
): Builder.BuildEffect<Builder.FullRoute[]> {
  const routes: Builder.FullRoute[] = [];

  // Client Root Route /
  routes.push(
    Builder.full_route(
      builder_name,
      Path.parse(config.root_path),
      Router.route("GET", "/", indexHandler),
    ),
  );

  // Client routes for child pages - all serve index.html for SPA behavior
  for (const route of state.routes) {
    routes.push(
      Builder.full_route(
        builder_name,
        route.file_entry.parsed_path,
        Router.route(
          "GET",
          strip_extension(route.file_entry.relative_path),
          indexHandler,
        ),
      ),
    );
  }

  // Bundle assets - serve from memory
  for (const [assetPath, contents] of bundle_assets) {
    const parsed_path = Path.parse(Path.normalize(assetPath));
    const mimeType = contentType(parsed_path.ext);
    const assetBytes = new Uint8Array(contents);
    const assetHandler: Router.Handler = Effect.gets(() =>
      Router.response(
        assetBytes,
        Router.response_init(
          Router.STATUS_CODE.OK,
          mimeType ? [[Router.HEADER.ContentType, mimeType]] : [],
        ),
      )
    );

    routes.push(
      Builder.full_route(
        builder_name,
        Path.parse(assetPath),
        Router.route("GET", assetPath, assetHandler),
      ),
    );
  }

  return Effect.wrap(routes);
}

/**
 * Creates a client SPA builder that processes preact components and generates
 * a bundled single-page application with client-side routing.
 *
 * The builder scans for files exporting ClientPage tokens (client_route,
 * client_default, client_wrapper, client_index) and generates:
 * - A bundled JavaScript entrypoint with lazy-loaded routes
 * - An HTML shell (index.html) for the SPA
 * - Routes that serve the HTML for client-side navigation
 *
 * @example
 * ```ts
 * import { client_builder } from "@baetheus/pick/builder_client";
 *
 * const builder = client_builder({
 *   title: "My Application",
 *   minify: true,
 *   include_extensions: [".tsx"],
 * });
 * ```
 *
 * @since 0.3.0
 */
export function client_builder(
  _client_config: ClientBuilderOptions = {},
): Builder.Builder {
  const client_config = {
    name: "DefaultClientBuilder",
    title: "My Site",
    include_extensions: [".ts", ".tsx"],
    ..._client_config,
  };

  // Closure state for accumulating client routes and components
  const state: ClientBuilderState = {
    routes: [],
    default_routes: [],
    wrappers: [],
    indices: [],
  };

  return {
    name: client_config.name,
    process_file: (file_entry) => {
      // Bail on non-included extensions
      if (
        !client_config.include_extensions.includes(file_entry.parsed_path.ext)
      ) {
        return Effect.right([]);
      }

      return pipe(
        Builder.safe_import(file_entry.parsed_path),
        Effect.flatmap((exports) => {
          const export_pairs = Object.entries(exports);

          // Partition the exports
          for (const export_pair of export_pairs) {
            if (client_route_pair(export_pair)) {
              state.routes.push({ file_entry, export_pair });
            } else if (client_default_pair(export_pair)) {
              state.default_routes.push({ file_entry, export_pair });
            } else if (client_wrapper_pair(export_pair)) {
              state.wrappers.push({ file_entry, export_pair });
            } else if (client_index_pair(export_pair)) {
              state.indices.push({ file_entry, export_pair });
            }
          }

          // Return empty routes during process_file; routes created in process_build
          return Effect.right([]);
        }),
      );
    },
    process_build: (_routes) =>
      pipe(
        Effect.get<[Builder.BuildConfig]>(),
        Effect.map((config) => config[0]),
        Effect.bindTo("config"),
        Effect.bind("state", () => check_builder_state(state)),
        Effect.bind("entrypoint", ({ state }) => create_entrypoint(state)),
        Effect.bind("bundle_assets", ({ config, entrypoint }) =>
          create_bundle_assets(entrypoint, {
            // Defaults
            format: "esm",
            minify: true,
            codeSplitting: true,
            inlineImports: true,
            packages: "bundle",
            sourcemap: "linked",
            platform: "browser",
            // Custom overrides
            ...client_config.bundler_options ?? {},
            // Requirements
            outputDir: config.root_path,
            entrypoints: [entrypoint],
          })),
        Effect.bind("indexHandler", ({ bundle_assets, state }) =>
          create_index_handler(bundle_assets, state, client_config.title)),
        Effect.bind(
          "routes",
          ({ config, indexHandler, state, bundle_assets }) =>
            create_routes(
              config,
              indexHandler,
              state,
              bundle_assets,
              client_config.name,
            ),
        ),
        Effect.map(({ routes }) =>
          routes
        ),
      ),
  };
}
