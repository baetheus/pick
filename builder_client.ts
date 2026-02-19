import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import * as Path from "@std/path";
import * as Refinement from "@baetheus/fun/refinement";
import * as esbuild from "esbuild";
import { pipe } from "@baetheus/fun/fn";
import { contentType } from "@std/media-types";
import { denoPlugins } from "@luca/esbuild-deno-loader";
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

export type ClientBuilderOptions = {
  readonly name: string;
  readonly title: string;
  readonly jsx: "transform" | "preserve" | "automatic";
  readonly jsxImportSource: string;
  readonly treeShaking: boolean;
  readonly minify: boolean;
  readonly sourcemap: boolean | "inline" | "external";
  readonly splitting: boolean;
  readonly target: string[];
  readonly configPath: string;
  readonly include_extensions: string[];
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

function safe_import(
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
      client_builder_error("Unable to import file.", { error, parsed_path }),
  );
}

function strip_parsed_path_extension(
  parsed_path: Path.ParsedPath,
): Path.ParsedPath {
  return {
    ...parsed_path,
    ext: "",
  };
}

function strip_extension(path: string): string {
  const parsed_path = Path.parse(path);
  const stripped_path = strip_parsed_path_extension(parsed_path);
  return Path.format(stripped_path);
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
    moduleSpecifier: `file://${wrapper.file_entry.absolute_path}`,
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
            `lazy(() => import("file://${route.file_entry.absolute_path}").then(m => ({ default: m.${
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
          `lazy(() => import("file://${defaultRoute.file_entry.absolute_path}").then(m => ({ default: m.${
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
                `h(Route, { path: "${route.file_entry.relative_path}", component: Route${index} }),`,
              );
            });
            if (state.default_routes.length > 0) {
              writer.writeLine(
                `h(Route, { path: "/*", component: DefaultRoute }),`,
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
    writer.writeLine("// Mount the application");
    writer.write("if (document?.body)").block(() => {
      writer.writeLine(
        `render(h(App, null), document.getElementById("app"));`,
      );
    });
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

export function client_builder({
  name = "DefaultClientBuilder",
  title = "App",
  minify = true,
  treeShaking = true,
  sourcemap = true,
  splitting = false,
  target = ["es2020"],
  jsx = "automatic",
  jsxImportSource = "preact",
  configPath,
  include_extensions = [".ts", ".tsx"],
}: Partial<ClientBuilderOptions> = {}): Builder.Builder {
  // Closure state for accumulating client routes and components
  const state: ClientBuilderState = {
    routes: [],
    default_routes: [],
    wrappers: [],
    indices: [],
  };

  return {
    name,
    process_file: (file_entry) => {
      // Bail on non-included extensions
      if (!include_extensions.includes(file_entry.parsed_path.ext)) {
        return Effect.right([]);
      }

      return pipe(
        safe_import(file_entry.parsed_path),
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

    process_build: (_routes) => {
      if (state.routes.length === 0) {
        return Effect.right([]);
      }

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

      return Effect.tryCatch(
        async (config) => {
          // Step 1: Generate TypeScript Entrypoint with ts-morph
          const tempFilePath = await config.fs.makeTempFile({ suffix: ".ts" });
          const sourceText = generateEntrypointSource(tempFilePath, state);

          // Step 2: Write Temp File
          const encoder = new TextEncoder();
          const sourceBytes = encoder.encode(sourceText);
          await config.fs.write(Path.parse(tempFilePath), sourceBytes);

          // Step 3: Bundle with esbuild
          const esbuildConfig: esbuild.BuildOptions = {
            entryPoints: [tempFilePath],
            bundle: true,
            write: false,
            outdir: "/",
            format: "esm",
            splitting,
            minify,
            treeShaking,
            sourcemap,
            target,
            jsx,
            jsxImportSource,
            entryNames: "[name]-[hash]",
            chunkNames: "chunks/[name]-[hash]",
            assetNames: "assets/[name]-[hash]",
            plugins: configPath ? denoPlugins({ configPath }) : denoPlugins(),
          };

          const result = await esbuild.build(esbuildConfig);

          // Step 4: Process esbuild Output
          const bundleAssets = new Map<string, Uint8Array>();
          const outfiles = result.outputFiles ?? [];

          for (const file of outfiles) {
            bundleAssets.set(file.path, file.contents);
          }

          // Step 5: Generate index.html
          const scripts = outfiles
            .filter((f) =>
              f.path.endsWith(".js") && !f.path.includes("/chunks/")
            )
            .map((f) => f.path);

          const styles = outfiles
            .filter((f) => f.path.endsWith(".css"))
            .map((f) => f.path);

          let indexHtml: string;

          if (state.indices.length > 0) {
            const index = state.indices[0];
            const IndexComponent = index.export_pair[1].component;
            const html = renderToString(
              h(IndexComponent, { scripts, styles, title }),
            );
            indexHtml = `<!DOCTYPE html>${html}`;
          } else {
            // Use default HTML template
            indexHtml = generateDefaultHtml(scripts, styles, title);
          }

          // Step 6: Create FullRoutes
          const fullRoutes: Builder.FullRoute[] = [];

          // Index handler - serves index.html
          const indexHandler: Router.Handler = Effect.right(
            Router.html(indexHtml),
          );

          // Root route
          fullRoutes.push(
            Builder.full_route(
              name,
              Path.parse(config.root_path),
              Router.route("GET", "/", indexHandler),
            ),
          );

          // Client routes - all serve index.html for SPA behavior
          for (const route of state.routes) {
            fullRoutes.push(
              Builder.full_route(
                name,
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
          for (const [assetPath, contents] of bundleAssets) {
            const mimeType = contentType(assetPath);
            // Create a new Uint8Array to ensure proper BodyInit compatibility
            const assetBytes = new Uint8Array(contents);
            const assetHandler: Router.Handler = Effect.right(
              new Response(assetBytes, {
                status: Router.STATUS_CODE.OK,
                headers: mimeType
                  ? [[Router.HEADER.ContentType, mimeType]]
                  : [],
              }),
            );

            fullRoutes.push(
              Builder.full_route(
                name,
                Path.parse(assetPath),
                Router.route("GET", assetPath, assetHandler),
              ),
            );
          }

          // Default route (SPA fallback) - serves index.html for unmatched routes
          // Only add if we have a default route component
          if (state.default_routes.length > 0) {
            const default_route = state.default_routes[0];
            fullRoutes.push(
              Builder.full_route(
                name,
                default_route.file_entry.parsed_path,
                Router.route("GET", "/*", indexHandler),
              ),
            );
          }

          return fullRoutes;
        },
        (error) => client_builder_error("esbuild bundling failed", { error }),
      );
    },
  };
}
