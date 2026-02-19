# ClientBuilder Design Document

## Overview

The ClientBuilder is a Builder implementation that processes client-side Preact
components and generates a bundled single-page application (SPA). It integrates
with the generic builder system to walk directories, identify client page
exports, and produce an in-memory bundle served via generated routes.

## Goals

1. Process files exporting `ClientRoute`, `ClientDefaultRoute`, `ClientIndex`,
   and `ClientWrapper` tokens
2. Generate a TypeScript entrypoint file using ts-morph
3. Bundle the application using esbuild with in-memory output
4. Serve all assets (JS, CSS, sourcemaps) from memory via FullRoutes
5. Generate and serve `index.html` for all client routes (SPA behavior)

## Token Handling

### ClientRoute

- **Detection**: Files exporting a value matching `client_route.refine()`
- **Route Path Derivation**:
  - Remove file extension (`.ts`, `.tsx`)
  - Convert `[param]` segments to `:param` format
  - Example: `/pages/users/[id].tsx` → `/pages/users/:id`
- **Storage**: Store `FileEntry`, export name, and derived route path in closure
- **Route Creation**: Create GET route serving `index.html`

#### Route Path Derivation Algorithm

```typescript
function deriveRoutePath(relative_path: string): string {
  return relative_path
    // Remove extension
    .replace(/\.(ts|tsx)$/, "")
    // Convert [param] to :param
    .replace(/\[([^\]]+)\]/g, ":$1");
}
```

### ClientDefaultRoute

- **Detection**: Files exporting a value matching `client_default.refine()`
- **Constraint**: Exactly one allowed; error if multiple detected
- **Route Path**: Wildcard `/*` for unmatched routes
- **Usage**: Rendered as fallback in Router component

### ClientIndex

- **Detection**: Files exporting a value matching `client_index.refine()`
- **Constraint**: Exactly one allowed; error if multiple detected
- **Route Creation**: None during `process_file`
- **Usage**: Used during `process_build` to render `index.html` with
  `prerender()`

### ClientWrapper

- **Detection**: Files exporting a value matching `client_wrapper.refine()`
- **Constraint**: Exactly one allowed; error if multiple detected
- **Route Creation**: None during `process_file`
- **Usage**: Wraps the entire Router tree; defaults to Preact Fragment if absent

## Builder Closure State

```typescript
type ClientBuilderState = {
  // Processed client routes with their derived paths
  routes: Array<{
    file_entry: FileEntry;
    export_name: string;
    route_path: string;
  }>;

  // Default route (404 handler)
  default_route: Option<{
    file_entry: FileEntry;
    export_name: string;
  }>;

  // Index component for HTML shell
  index: Option<{
    file_entry: FileEntry;
    export_name: string;
  }>;

  // Wrapper component
  wrapper: Option<{
    file_entry: FileEntry;
    export_name: string;
  }>;
};
```

## Phase 1: process_file

For each FileEntry with included extensions (`.ts`, `.tsx`):

1. Import the file using `safe_import()`
2. Iterate exports to find ClientPage tokens using refinement functions
3. For each token type found:
   - **ClientRoute**: Extract export name, derive route path, store in `routes`
   - **ClientDefaultRoute**: Validate uniqueness, store in `default_route`
   - **ClientIndex**: Validate uniqueness, store in `index`
   - **ClientWrapper**: Validate uniqueness, store in `wrapper`
4. For ClientRoute tokens, create a placeholder FullRoute (actual handler set in
   `process_build`)
5. Return empty routes array (routes created during `process_build`)

## Phase 2: process_build

### Step 1: Generate TypeScript Entrypoint with ts-morph

The entrypoint file is generated as pure TypeScript (`.ts`, not `.tsx`) using
Preact's `h()` function instead of JSX syntax. This avoids additional
transpilation complexity and makes the generated code explicit.

#### ts-morph Project Setup

```typescript
import { Project, StructureKind, VariableDeclarationKind } from "ts-morph";

// Create a ts-morph Project instance
// No tsconfig needed since we're generating code, not analyzing it
const project = new Project({
  useInMemoryFileSystem: false, // We write to the real filesystem via makeTempFile
});
```

#### Creating the Source File

First, obtain a temporary file path from the Filesystem interface, then create
the source file at that path:

```typescript
// Get temp file path from BuildConfig.Filesystem
const tempFilePath = await config.fs.makeTempFile({ suffix: ".ts" });

// Create source file at the temp path
// Using overwrite: true in case the temp file already exists
const sourceFile = project.createSourceFile(tempFilePath, "", {
  overwrite: true,
});
```

#### Adding Import Declarations

Use `addImportDeclaration()` to add each import. The method accepts an object
with `moduleSpecifier` and either `defaultImport`, `namespaceImport`, or
`namedImports`:

```typescript
// Import h, render, Fragment from preact
sourceFile.addImportDeclaration({
  moduleSpecifier: "preact",
  namedImports: ["h", "render", "Fragment"],
});

// Import preact-iso components
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

// Import wrapper component (if exists)
if (Option.isSome(state.wrapper)) {
  sourceFile.addImportDeclaration({
    moduleSpecifier: `file://${state.wrapper.value.file_entry.absolute_path}`,
    namedImports: [{
      name: state.wrapper.value.export_name,
      alias: "WrapperModule",
    }],
  });
}
```

#### Adding Lazy Route Variables

Use `addVariableStatement()` with `VariableDeclarationKind.Const` to create
lazy-loaded route constants:

```typescript
// Generate lazy imports for each route
state.routes.forEach((route, index) => {
  sourceFile.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [{
      name: `Route${index}`,
      initializer:
        `lazy(() => import("file://${route.file_entry.absolute_path}").then(m => ({ default: m.${route.export_name}.component })))`,
    }],
  });
});

// Default route (if exists)
if (Option.isSome(state.default_route)) {
  sourceFile.addVariableStatement({
    declarationKind: VariableDeclarationKind.Const,
    declarations: [{
      name: "DefaultRoute",
      initializer:
        `lazy(() => import("file://${state.default_route.value.file_entry.absolute_path}").then(m => ({ default: m.${state.default_route.value.export_name}.component })))`,
    }],
  });
}
```

#### Adding the App Function

Use `addFunction()` with `setBodyText()` to create the App component. The body
uses `h()` calls instead of JSX:

```typescript
const appFunction = sourceFile.addFunction({
  name: "App",
  isExported: false,
});

// Build the component tree using h() calls
// Structure: Wrapper > LocationProvider > ErrorBoundary > Router > Routes
appFunction.setBodyText((writer) => {
  writer.write("return ");

  // Wrapper (or Fragment if none)
  const wrapperComponent = Option.isSome(state.wrapper)
    ? "WrapperModule.component"
    : "Fragment";

  writer.write(`h(${wrapperComponent}, null,`).indent(() => {
    writer.write("h(LocationProvider, null,").indent(() => {
      writer.write("h(ErrorBoundary, null,").indent(() => {
        writer.write("h(Router, null,").indent(() => {
          // Add each route
          state.routes.forEach((route, index) => {
            writer.writeLine(
              `h(Route, { path: "${route.route_path}", component: Route${index} }),`,
            );
          });
          // Add default route if exists
          if (Option.isSome(state.default_route)) {
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
```

#### Adding the Render Statement

Use `addStatements()` to add the final render call:

```typescript
sourceFile.addStatements((writer) => {
  writer.blankLine();
  writer.writeLine("// Mount the application");
  writer.write("if (document?.body)").block(() => {
    writer.writeLine(`render(h(App, null), document.getElementById("app"));`);
  });
});
```

#### Getting the Generated Source Text

After all manipulations, retrieve the full source text:

```typescript
const sourceText = sourceFile.getFullText();
```

#### Complete Generated Output Example

The final generated `app.ts` file will look like:

```typescript
import { Fragment, h, render } from "preact";
import {
  ErrorBoundary,
  lazy,
  LocationProvider,
  Route,
  Router,
} from "preact-iso";
import { wrapper as WrapperModule } from "file:///absolute/path/to/wrapper.ts";

const Route0 = lazy(() =>
  import("file:///absolute/path/to/page.ts").then((m) => ({
    default: m.home.component,
  }))
);
const Route1 = lazy(() =>
  import("file:///absolute/path/to/users/[id].ts").then((m) => ({
    default: m.user.component,
  }))
);
const DefaultRoute = lazy(() =>
  import("file:///absolute/path/to/not-found.ts").then((m) => ({
    default: m.notFound.component,
  }))
);

function App() {
  return h(
    WrapperModule.component,
    null,
    h(
      LocationProvider,
      null,
      h(
        ErrorBoundary,
        null,
        h(
          Router,
          null,
          h(Route, { path: "/page", component: Route0 }),
          h(Route, { path: "/users/:id", component: Route1 }),
          h(Route, { path: "/*", component: DefaultRoute }),
        ),
      ),
    ),
  );
}

// Mount the application
if (document?.body) {
  render(h(App, null), document.body);
}
```

If no `ClientWrapper` exists, `Fragment` is used as the wrapper component.

### Step 2: Write Temp File

After generating the source file content, write it to the filesystem using the
BuildConfig's Filesystem interface:

```typescript
import * as Path from "@std/path";

// Get the source text from ts-morph
const sourceText = sourceFile.getFullText();

// Convert to Uint8Array for the Filesystem.write method
const encoder = new TextEncoder();
const sourceBytes = encoder.encode(sourceText);

// Write to the temp file path
await config.fs.write(Path.parse(tempFilePath), sourceBytes);
```

Note: We use `config.fs.write()` rather than ts-morph's `sourceFile.save()`
because the BuildConfig.Filesystem interface provides the abstraction layer for
file operations in the builder system.

### Step 3: Bundle with esbuild

The generated entrypoint is pure TypeScript using `h()` calls, so no JSX
transformation is needed for the entrypoint itself. However, the lazy-imported
route components may still use JSX, so we configure esbuild to handle both:

```typescript
const result = await esbuild.build({
  entryPoints: [tempFilePath],
  bundle: true,
  write: false, // In-memory output
  outdir: "/", // Virtual output directory
  format: "esm",
  splitting: options.splitting,
  minify: options.minify,
  treeShaking: options.treeShaking,
  sourcemap: options.sourcemap,
  target: options.target,
  // JSX config for lazy-imported route components (which may use JSX)
  jsx: options.jsx,
  jsxImportSource: options.jsxImportSource,
  entryNames: "[name]-[hash]",
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  plugins: denoPlugins({ configPath: options.configPath }),
});
```

### Step 4: Process esbuild Output

For each `OutputFile` in `result.outputFiles`:

1. Determine the route path from `outputFile.path`
2. Store the `Uint8Array` content in memory
3. Determine MIME type from extension
4. Create a FullRoute serving the content

```typescript
const output_routes: Map<string, Uint8Array> = new Map();

for (const file of result.outputFiles) {
  // file.path is the virtual path (e.g., "/main-ABC123.js")
  output_routes.set(file.path, file.contents);
}
```

### Step 5: Generate index.html

Using the ClientIndex component (or a default template):

```typescript
import { prerender } from "preact-iso";
import { renderToString } from "preact-render-to-string";

// Get script paths from esbuild output
const scripts = result.outputFiles
  .filter((f) => f.path.endsWith(".js"))
  .map((f) => f.path);

const styles = result.outputFiles
  .filter((f) => f.path.endsWith(".css"))
  .map((f) => f.path);

// If ClientIndex exists, use it
if (Option.isSome(state.index)) {
  const indexModule = await import(state.index.value.file_entry.absolute_path);
  const IndexComponent = indexModule[state.index.value.export_name].component;

  const html = renderToString(
    <IndexComponent scripts={scripts} styles={styles} title={options.title} />,
  );

  indexHtml = `<!DOCTYPE html>${html}`;
} else {
  // Default HTML template
  indexHtml = generateDefaultHtml(scripts, styles, options.title);
}
```

Default HTML template:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('\n')}
  </head>
  <body>
    <div id="app"></div>
    ${scripts.map(s => `<script type="module" src="${s}"></script>`).join('\n')}
  </body>
</html>
```

### Step 6: Create FullRoutes

Generate routes for:

1. **Root route** (`/`): Serves `index.html`
2. **Client routes**: Each derived route path serves `index.html`
3. **Bundle assets**: Each esbuild output file at its hashed path
4. **Default route** (`/*`): Serves `index.html` for SPA fallback

```typescript
const fullRoutes: FullRoute[] = [];

// Index route
fullRoutes.push(
  full_route(name, parsed_path, Router.route("GET", "/", indexHandler)),
);

// Client routes - all serve index.html
for (const route of state.routes) {
  fullRoutes.push(
    full_route(
      name,
      route.file_entry.parsed_path,
      Router.route("GET", route.route_path, indexHandler),
    ),
  );
}

// Bundle assets
for (const [path, contents] of output_routes) {
  const mime = getMimeType(path);
  fullRoutes.push(
    full_route(
      name,
      parsed_path,
      Router.route("GET", path, createAssetHandler(contents, mime)),
    ),
  );
}
```

## Error Handling

| Error Condition             | Error Type         | Message                                     |
| --------------------------- | ------------------ | ------------------------------------------- |
| Multiple ClientDefaultRoute | ClientBuilderError | "Multiple ClientDefaultRoute exports found" |
| Multiple ClientWrapper      | ClientBuilderError | "Multiple ClientWrapper exports found"      |
| Multiple ClientIndex        | ClientBuilderError | "Multiple ClientIndex exports found"        |
| Import failure              | ClientBuilderError | "Unable to import file"                     |
| esbuild failure             | ClientBuilderError | "esbuild bundling failed"                   |
| Temp file creation failure  | ClientBuilderError | "Unable to create temp file"                |

## ClientBuilderOptions

```typescript
type ClientBuilderOptions = {
  readonly name: string; // Builder name (default: "DefaultClientBuilder")
  readonly title: string; // HTML page title
  readonly jsx: "transform" | "preserve" | "automatic";
  readonly jsxImportSource: string; // Default: "preact"
  readonly treeShaking: boolean; // Default: true
  readonly minify: boolean; // Default: true
  readonly sourcemap: boolean | "inline" | "external";
  readonly splitting: boolean; // Default: false
  readonly target: string[]; // Default: ["es2020"]
  readonly configPath: string; // Deno config path for esbuild-deno-loader
  readonly include_extensions: string[]; // Default: [".ts", ".tsx"]
};
```

## Memory Management

All bundle outputs are stored in closure variables:

- `bundleAssets: Map<string, Uint8Array>` - JS/CSS/sourcemap contents
- `indexHtml: string` - Generated HTML content

Route handlers create Responses from these stored values on each request.

## Dependencies

- `ts-morph` - TypeScript AST generation
- `esbuild` - JavaScript bundling
- `@luca/esbuild-deno-loader` - Deno import resolution for esbuild
- `preact-iso` - SPA routing (LocationProvider, Router, Route, ErrorBoundary,
  lazy)
- `preact-render-to-string` - Server-side rendering for index.html
- `preact` - UI framework

## ts-morph API Reference

The following ts-morph APIs are used in the ClientBuilder:

### Project

| Method                                           | Description                            |
| ------------------------------------------------ | -------------------------------------- |
| `new Project(options?)`                          | Create a new project instance          |
| `project.createSourceFile(path, text, options?)` | Create a source file at the given path |

**Project Options:**

- `useInMemoryFileSystem: boolean` - Use virtual filesystem (default: false)
- `compilerOptions: object` - TypeScript compiler options
- `tsConfigFilePath: string` - Path to tsconfig.json

### SourceFile

| Method                                           | Description                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| `sourceFile.addImportDeclaration(structure)`     | Add an import statement                              |
| `sourceFile.addImportDeclarations(structures[])` | Add multiple imports                                 |
| `sourceFile.addVariableStatement(structure)`     | Add a variable declaration                           |
| `sourceFile.addFunction(structure)`              | Add a function declaration                           |
| `sourceFile.addStatements(text \| writerFn)`     | Add arbitrary statements                             |
| `sourceFile.getFullText()`                       | Get the complete source text                         |
| `sourceFile.save()`                              | Save to filesystem (not used; we use BuildConfig.fs) |

### ImportDeclarationStructure

```typescript
{
  moduleSpecifier: string;           // e.g., "preact"
  defaultImport?: string;            // e.g., "React"
  namespaceImport?: string;          // e.g., "* as Preact"
  namedImports?: (string | {         // e.g., ["h", "render"]
    name: string;
    alias?: string;
  })[];
}
```

### VariableStatementStructure

```typescript
{
  declarationKind: VariableDeclarationKind; // Const, Let, or Var
  declarations: Array<{
    name: string;
    initializer?: string;
    type?: string;
  }>;
}
```

### FunctionDeclarationStructure

```typescript
{
  name: string;
  isExported?: boolean;
  isAsync?: boolean;
  parameters?: Array<{ name: string; type?: string }>;
  returnType?: string;
  statements?: string | WriterFunction;
}
```

### WriterFunction Pattern

The writer function provides a fluent API for building code:

```typescript
sourceFile.addStatements((writer) => {
  writer
    .writeLine("// Comment")
    .write("if (condition)")
    .block(() => {
      writer.writeLine("doSomething();");
    })
    .blankLine()
    .write("return value;");
});
```

| Writer Method     | Description                             |
| ----------------- | --------------------------------------- |
| `write(text)`     | Write text without newline              |
| `writeLine(text)` | Write text with newline                 |
| `blankLine()`     | Insert empty line                       |
| `block(fn)`       | Write `{ }` block with indented content |
| `indent(fn)`      | Indent content without braces           |
| `newLine()`       | Insert newline                          |
| `quote(text)`     | Write quoted string                     |

## Example Usage

```typescript
// routes/pages/index.tsx
import { client_route } from "@baetheus/pick/tokens";

function HomePage() {
  return <h1>Welcome</h1>;
}

export const home = client_route.create(HomePage);

// routes/pages/users/[id].tsx
import { client_route } from "@pick/tokens";

function UserPage({ params }: { params: { id: string } }) {
  return <h1>User {params.id}</h1>;
}

export const user = client_route.create(UserPage);

// routes/_index.tsx
import { client_index } from "@pick/tokens";
import type { ClientIndexParameters } from "@pick/tokens";

function Index({ scripts, styles, title }: ClientIndexParameters) {
  return (
    <html>
      <head>
        <title>{title}</title>
        {styles.map((s) => <link rel="stylesheet" href={s} />)}
      </head>
      <body>
        <div id="app" />
        {scripts.map((s) => <script type="module" src={s} />)}
      </body>
    </html>
  );
}

export const index = client_index.create(Index);

// routes/_wrapper.tsx
import { client_wrapper } from "@pick/tokens";
import type { ClientWrapperParameters } from "@pick/tokens";

function Wrapper({ children }: ClientWrapperParameters) {
  return (
    <ThemeProvider>
      <AuthProvider>
        {children}
      </AuthProvider>
    </ThemeProvider>
  );
}

export const wrapper = client_wrapper.create(Wrapper);

// routes/_not_found.tsx
import { client_default } from "@pick/tokens";

function NotFound() {
  return <h1>404 - Page Not Found</h1>;
}

export const notFound = client_default.create(NotFound);
```

## File Structure After Build

```
Memory-served routes:
  GET /                      -> index.html
  GET /pages/index           -> index.html
  GET /pages/users/:id       -> index.html
  GET /*                     -> index.html (SPA fallback)
  GET /main-a1b2c3.js        -> bundle (from esbuild)
  GET /chunks/user-d4e5f6.js -> chunk (from esbuild, if splitting enabled)
  GET /main-a1b2c3.js.map    -> sourcemap (if enabled)
```

## Open Questions

1. Should there be dev mode with HMR support?
2. Should CSS modules or other CSS processing be supported via esbuild plugins?
3. Should there be a way to configure the HTML app container id (currently
   hardcoded as "app")?
4. Should prerendering of routes be supported for SSG output?
