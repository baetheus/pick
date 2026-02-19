import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import * as Path from "@std/path";
import * as Refinement from "@baetheus/fun/refinement";
import { pipe } from "@baetheus/fun/fn";
import { contentType } from "@std/media-types";
import {
  Project,
  type SourceFile,
  VariableDeclarationKind,
} from "@ts-morph/ts-morph";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";

import * as Builder from "./builder.ts";
import * as Router from "./router.ts";
import * as Tokens from "./tokens.ts";

const client_builder_error = Err.err("ClientBuilderError");

export type ClientBuilderOptions = Omit<Deno.bundle.Options, "entrypoints"> & {
  readonly name?: string;
  readonly title?: string;
  readonly include_extensions?: string[];
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

function addPreactImports(sourceFile: SourceFile): void {
  sourceFile.addImportDeclaration({
    moduleSpecifier: "preact",
    namedImports: ["h", "render", "Fragment"],
  });

  sourceFile.addImportDeclaration({
    moduleSpecifier: "preact-iso",
    namedImports: [
      "LocationProvider",
      "Router",
      "Route",
      "ErrorBoundary",
      "lazy",
    ],
  });
}

function addWrapperImport(
  sourceFile: SourceFile,
  wrapper: ClientRouteEntry<"ClientWrapper", Tokens.ClientWrapperParameters>,
): void {
  sourceFile.addImportDeclaration({
    moduleSpecifier: `${wrapper.file_entry.absolute_path}`,
    namedImports: [
      {
        name: wrapper.export_pair[0],
        alias: "WrapperModule",
      },
    ],
  });
}

function addLazyRouteVariables(
  sourceFile: SourceFile,
  routes: ClientRouteEntry<"ClientRoute">[],
): void {
  routes.forEach((route, index) => {
    sourceFile.addVariableStatement({
      declarationKind: VariableDeclarationKind.Const,
      declarations: [
        {
          name: `Route${index}`,
          initializer:
            `lazy(() => import("${route.file_entry.absolute_path}").then(m => ({ default: m.${
              route.export_pair[0]
            }.component })))`,
        },
      ],
    });
  });
}

function addDefaultRouteVariable(
  sourceFile: SourceFile,
  defaultRoute: ClientRouteEntry<"ClientDefaultRoute">,
): void {
  sourceFile.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: "DefaultRoute",
        initializer:
          `lazy(() => import("${defaultRoute.file_entry.absolute_path}").then(m => ({ default: m.${
            defaultRoute.export_pair[0]
          }.component })))`,
      },
    ],
  });
}

function addAppFunction(
  sourceFile: SourceFile,
  state: ClientBuilderState,
): void {
  const appFunction = sourceFile.addFunction({
    name: "App",
    isExported: false,
  });

  appFunction.setBodyText((writer) => {
    writer.write("return ");

    const wrapperComponent = state.wrappers.length > 0
      ? "WrapperModule.component"
      : "Fragment";

    writer.write(`h(${wrapperComponent}, null,`);
    writer.indent(() => {
      writer.write("h(LocationProvider, null,");
      writer.indent(() => {
        writer.write("h(ErrorBoundary, null,");
        writer.indent(() => {
          writer.write("h(Router, null,");
          writer.indent(() => {
            state.routes.forEach((route, index) => {
              writer.writeLine(
                `h(Route, { path: "${
                  strip_extension(route.file_entry.relative_path)
                }", component: Route${index} }),`,
              );
            });
            if (state.default_routes.length > 0) {
              writer.writeLine(
                `h(Route, { path: "/*", component: DefaultRoute, default: true }),`,
              );
            }
          });
          writer.write(")"); // Close Router
        });
        writer.write(")"); // Close ErrorBoundary
      });
      writer.write(")"); // Close LocationProvider
    });
    writer.write(")"); // Close Wrapper
    writer.write(";");
  });
}

function addRenderStatement(sourceFile: SourceFile): void {
  sourceFile.addStatements((writer) => {
    writer.blankLine();
    writer.writeLine(`render(App(), document.body);`);
  });
}

function generateEntrypointSource(
  tempFilePath: string,
  state: ClientBuilderState,
): string {
  const project = new Project({
    useInMemoryFileSystem: false,
  });

  const sourceFile = project.createSourceFile(tempFilePath, "", {
    overwrite: true,
  });

  addPreactImports(sourceFile);

  if (state.wrappers.length > 0) {
    addWrapperImport(sourceFile, state.wrappers[0]);
  }

  addLazyRouteVariables(sourceFile, state.routes);

  if (state.default_routes.length > 0) {
    addDefaultRouteVariable(sourceFile, state.default_routes[0]);
  }

  addAppFunction(sourceFile, state);
  addRenderStatement(sourceFile);

  return sourceFile.getFullText();
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

export function client_builder(
  _client_config: ClientBuilderOptions = {},
): Builder.Builder {
  const client_config = {
    name: "DefaultClientBuilder",
    title: "My Site",
    include_extensions: [".ts", ".tsx"],
    minify: true,
    codeSplitting: true,
    inlineImports: true,
    sourcemap: "linked" as const,
    outputDir: "./",
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
        Effect.bindTo("config"),
        Effect.bind("state", () => check_builder_state(state)),
        Effect.bind("entrypoint", ({ state }) =>
          Effect.gets(async (config) => {
            // Step 1: Generate TypeScript Entrypoint with ts-morph
            const tempFilePath = await config.fs.makeTempFile({
              prefix: "bundle-",
              suffix: ".ts",
            });
            const sourceText = generateEntrypointSource(tempFilePath, state);

            // Step 2: Write Temp File
            const encoder = new TextEncoder();
            const sourceBytes = encoder.encode(sourceText);
            await config.fs.write(Path.parse(tempFilePath), sourceBytes);
            return tempFilePath;
          })),
        Effect.bind(
          "bundle_assets",
          ({ entrypoint }) =>
            pipe(
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
                      // Deno bundle nonsnse
                      map.set(
                        file.path === "<stdout>"
                          ? `bundle-${file.hash}.js`
                          : file.path,
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
            ),
        ),
        Effect.bind(
          "indexHandler",
          ({ bundle_assets, state }) => {
            const assets = Array.from(bundle_assets.keys());
            const scripts = assets.filter((path) => path.endsWith(".js"));
            const styles = assets.filter((path) => path.endsWith(".css"));
            let html: string;

            if (state.indices.length > 0) {
              const index = state.indices[0];
              const IndexComponent = index.export_pair[1].component;
              html = renderToString(h(IndexComponent, {
                title: client_config.title,
                scripts,
                styles,
              }));
            } else {
              html = generateDefaultHtml(
                scripts,
                styles,
                client_config.title,
              );
            }
            return Effect.wrap(
              Effect.gets(() => Router.html(html)) as Router.Handler,
            );
          },
        ),
        Effect.bind(
          "routes",
          ({ indexHandler, state, bundle_assets }) => {
            const routes: Builder.FullRoute[] = [];

            // Client Root Route /
            // routes.push(
            //   Builder.full_route(
            //     client_config.name,
            //     Path.parse(config[0].root_path),
            //     Router.route("GET", "/", indexHandler),
            //   ),
            // );

            // Client routes for child pages - all serve index.html for SPA behavior
            for (const route of state.routes) {
              routes.push(
                Builder.full_route(
                  client_config.name,
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
              const parsed_path = Path.parse(
                Path.normalize(assetPath),
              );
              const mimeType = contentType(parsed_path.ext);
              // Create a new Uint8Array to ensure proper BodyInit compatibility
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
                  client_config.name,
                  Path.parse(assetPath),
                  Router.route("GET", assetPath, assetHandler),
                ),
              );
            }

            // Default route (SPA fallback) - serves index.html for unmatched routes
            // Only add if we have a default route component
            if (state.default_routes.length > 0) {
              const default_route = state.default_routes[0];
              routes.push(
                Builder.full_route(
                  client_config.name,
                  default_route.file_entry.parsed_path,
                  Router.route("GET", "/", indexHandler),
                ),
              );
            }

            return Effect.wrap(routes);
          },
        ),
        Effect.map(({ routes }) => routes),
      ),
  };
}
