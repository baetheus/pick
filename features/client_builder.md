# ClientBuilder Design Document

## Overview

The ClientBuilder is a Builder implementation that processes client-side Preact components and generates a bundled single-page application (SPA). It integrates with the generic builder system to walk directories, identify client page exports, and produce an in-memory bundle served via generated routes.

## Goals

1. Process files exporting `ClientRoute`, `ClientDefaultRoute`, `ClientIndex`, and `ClientWrapper` tokens
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
  - Example: `/pages/users/[id].tsx` → `/users/:id`
- **Storage**: Store `FileEntry` and derived route path in closure
- **Route Creation**: Create GET route serving `index.html`

### ClientDefaultRoute

- **Detection**: Files exporting a value matching `client_default.refine()`
- **Constraint**: Exactly one allowed; error if multiple detected
- **Route Path**: Wildcard `/*` for unmatched routes
- **Usage**: Rendered as fallback in Router component

### ClientIndex

- **Detection**: Files exporting a value matching `client_index.refine()`
- **Constraint**: Exactly one allowed; error if multiple detected
- **Route Creation**: None during `process_file`
- **Usage**: Used during `process_build` to render `index.html` with `prerender()`

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
4. For ClientRoute tokens, create a placeholder FullRoute (actual handler set in `process_build`)
5. Return empty routes array (routes created during `process_build`)

### Route Path Derivation Algorithm

```typescript
function deriveRoutePath(relative_path: string): string {
  return relative_path
    // Remove extension
    .replace(/\.(ts|tsx)$/, '')
    // Convert [param] to :param
    .replace(/\[([^\]]+)\]/g, ':$1');
}
```

## Phase 2: process_build

### Step 1: Generate TypeScript Entrypoint

Using ts-morph, create a source file with:

```typescript
// Generated imports
import { render, hydrate } from 'preact';
import { LocationProvider, Router, Route, ErrorBoundary, lazy } from 'preact-iso';
import { Fragment } from 'preact';

// Wrapper import (if exists)
import { ExportName as Wrapper } from 'file:///absolute/path/to/wrapper.tsx';

// Lazy route imports
const Route0 = lazy(() => import('file:///absolute/path/to/page.tsx').then(m => ({ default: m.ExportName.component })));
const Route1 = lazy(() => import('file:///absolute/path/to/other.tsx').then(m => ({ default: m.ExportName.component })));
const DefaultRoute = lazy(() => import('file:///absolute/path/to/not-found.tsx').then(m => ({ default: m.ExportName.component })));

// App component
function App() {
  return (
    <Wrapper>
      <LocationProvider>
        <ErrorBoundary>
          <Router>
            <Route path="/page" component={Route0} />
            <Route path="/other" component={Route1} />
            <Route path="/*" component={DefaultRoute} />
          </Router>
        </ErrorBoundary>
      </LocationProvider>
    </Wrapper>
  );
}

// Hydrate if pre-rendered, otherwise render
if (document.getElementById('app')?.hasChildNodes()) {
  hydrate(<App />, document.getElementById('app')!);
} else {
  render(<App />, document.getElementById('app')!);
}
```

If no `ClientWrapper` exists, use `Fragment` as the wrapper.

### Step 2: Write Temp File

Use `config.fs.makeTempFile({ suffix: '.tsx' })` to create a temporary entrypoint file and write the generated source.

### Step 3: Bundle with esbuild

```typescript
const result = await esbuild.build({
  entryPoints: [tempFilePath],
  bundle: true,
  write: false,  // In-memory output
  outdir: '/',   // Virtual output directory
  format: 'esm',
  splitting: options.splitting,
  minify: options.minify,
  treeShaking: options.treeShaking,
  sourcemap: options.sourcemap,
  target: options.target,
  jsx: options.jsx,
  jsxImportSource: options.jsxImportSource,
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
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
import { prerender } from 'preact-iso';
import { renderToString } from 'preact-render-to-string';

// Get script paths from esbuild output
const scripts = result.outputFiles
  .filter(f => f.path.endsWith('.js'))
  .map(f => f.path);

const styles = result.outputFiles
  .filter(f => f.path.endsWith('.css'))
  .map(f => f.path);

// If ClientIndex exists, use it
if (Option.isSome(state.index)) {
  const indexModule = await import(state.index.value.file_entry.absolute_path);
  const IndexComponent = indexModule[state.index.value.export_name].component;

  const html = renderToString(
    <IndexComponent scripts={scripts} styles={styles} title={options.title} />
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
  full_route(name, parsed_path, Router.route('GET', '/', indexHandler))
);

// Client routes - all serve index.html
for (const route of state.routes) {
  fullRoutes.push(
    full_route(name, route.file_entry.parsed_path,
      Router.route('GET', route.route_path, indexHandler))
  );
}

// Bundle assets
for (const [path, contents] of output_routes) {
  const mime = getMimeType(path);
  fullRoutes.push(
    full_route(name, parsed_path,
      Router.route('GET', path, createAssetHandler(contents, mime)))
  );
}
```

## Error Handling

| Error Condition | Error Type | Message |
|-----------------|------------|---------|
| Multiple ClientDefaultRoute | ClientBuilderError | "Multiple ClientDefaultRoute exports found" |
| Multiple ClientWrapper | ClientBuilderError | "Multiple ClientWrapper exports found" |
| Multiple ClientIndex | ClientBuilderError | "Multiple ClientIndex exports found" |
| Import failure | ClientBuilderError | "Unable to import file" |
| esbuild failure | ClientBuilderError | "esbuild bundling failed" |
| Temp file creation failure | ClientBuilderError | "Unable to create temp file" |

## ClientBuilderOptions

```typescript
type ClientBuilderOptions = {
  readonly name: string;              // Builder name (default: "DefaultClientBuilder")
  readonly title: string;             // HTML page title
  readonly jsx: "transform" | "preserve" | "automatic";
  readonly jsxImportSource: string;   // Default: "preact"
  readonly treeShaking: boolean;      // Default: true
  readonly minify: boolean;           // Default: true
  readonly sourcemap: boolean | "inline" | "external";
  readonly splitting: boolean;        // Default: false
  readonly target: string[];          // Default: ["es2020"]
  readonly configPath: string;        // Deno config path for esbuild-deno-loader
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
- `preact-iso` - SPA routing (LocationProvider, Router, Route, ErrorBoundary, lazy)
- `preact-render-to-string` - Server-side rendering for index.html
- `preact` - UI framework

## Example Usage

```typescript
// routes/pages/index.tsx
import { client_route } from '@pick/tokens';

function HomePage() {
  return <h1>Welcome</h1>;
}

export const home = client_route.create(HomePage);

// routes/pages/users/[id].tsx
import { client_route } from '@pick/tokens';

function UserPage({ params }: { params: { id: string } }) {
  return <h1>User {params.id}</h1>;
}

export const user = client_route.create(UserPage);

// routes/_index.tsx
import { client_index } from '@pick/tokens';
import type { ClientIndexParameters } from '@pick/tokens';

function Index({ scripts, styles, title }: ClientIndexParameters) {
  return (
    <html>
      <head>
        <title>{title}</title>
        {styles.map(s => <link rel="stylesheet" href={s} />)}
      </head>
      <body>
        <div id="app" />
        {scripts.map(s => <script type="module" src={s} />)}
      </body>
    </html>
  );
}

export const index = client_index.create(Index);

// routes/_wrapper.tsx
import { client_wrapper } from '@pick/tokens';
import type { ClientWrapperParameters } from '@pick/tokens';

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
import { client_default } from '@pick/tokens';

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
3. Should there be a way to configure the HTML app container id (currently hardcoded as "app")?
4. Should prerendering of routes be supported for SSG output?
