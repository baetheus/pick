# Client Routing Redesign

## Overview

This document describes a redesign of the client SPA implementation in `builder.ts`. The goal is to simplify the client builder by:

1. **Single SPA per build** - Remove support for multiple SPA bundles per builder run
2. **Remove client_root and client_redirect** - Replace with a simpler token-based system
3. **Tight coupling** - Bind directly to esbuild, preact, and preact-iso instead of requiring a bundler parameter
4. **Convention-based routing** - Use special files (`_root.tsx`, `_index.tsx`, `_404.tsx`) and page tokens
5. **Code generation with ts-morph** - Use ts-morph to generate the application entry point instead of string manipulation

---

## Design

### Special Files

The builder recognizes three special files at the root of the routes directory:

| File | Purpose | Required |
|------|---------|----------|
| `_root.tsx` | Application wrapper component | No (default wrapper provided) |
| `_index.tsx` | HTML shell generator using `index_page` token | No (default provided) |
| `_404.tsx` | Default/fallback route for unmatched paths | No (default 404 provided) |

### Index Page Token

The `_index.tsx` file uses a special `index_page` token to generate the HTML shell
that hosts the SPA. The component is rendered to string using preact's render-to-string.

```typescript
import type { FunctionComponent } from "preact";

type IndexPageSymbol = "INDEX_PAGE";

type IndexPageParameters = {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly title: string;
};

type IndexPage = {
  readonly type: IndexPageSymbol;
  readonly component: FunctionComponent<IndexPageParameters>;
};

function index_page(component: FunctionComponent<IndexPageParameters>): IndexPage;
```

**Usage Example:**

```tsx
// routes/_index.tsx
import { index_page } from "@baetheus/pick/builder";
import type { IndexPageParameters } from "@baetheus/pick/builder";

function Shell({ scripts, styles, title }: IndexPageParameters) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {styles.map((href) => <link rel="stylesheet" href={href} />)}
      </head>
      <body>
        {scripts.map((src) => <script type="module" src={src} />)}
      </body>
    </html>
  );
}

export default index_page(Shell);
```

### Dynamic Route Parameters

Dynamic route segments use **colon syntax** in filenames to match preact-iso's
route syntax:

```
routes/
  users/
    :userid.tsx      → /users/:userid
    :userid/
      settings.tsx   → /users/:userid/settings
```


### Client Page Token

Similar to the existing `PartialRoute` pattern for server routes, we introduce
a `ClientPage` token for client-side pages. The client page token should be
placed in its own tokens file to keep esbuild from needing to tree shake
references to builder dependencies. Any other tokens should be moved to this
file and the builder.ts file should import them as a dependency.

```typescript
import type { FunctionComponent } from "preact";

type ClientPageSymbol = "CLIENT_PAGE";

type ClientPage = {
  readonly type: ClientPageSymbol;
  readonly title: string;
  readonly component: FunctionComponent;
};

function client_page(title: string, component: FunctionComponent): ClientPage;
```

The `component` parameter is stored in the token and used with **object equality**
to find the exact export from the module. This allows server routes to coexist
in the same file alongside client pages.

**Usage Example:**

```tsx
// routes/dashboard.tsx
import { client_page, partial_route } from "@baetheus/pick/builder";

// Client page export
export function Page() {
  return <div>Dashboard content</div>;
}

export default client_page("Dashboard", Page);

// Server route can coexist in same file
export const api = partial_route("GET", "/api/dashboard", () => {
  return Response.json({ data: "..." });
});
```

The builder:
1. Detects the `client_page` export during directory walk
2. Uses object equality to match the component reference to its export name
3. Records the path and page metadata
4. Generates a route in the application with appropriate typing

### Generated Application Structure

The builder generates a temporary TSX file using `Deno.makeTempFile()` that assembles the SPA:

```tsx
// Generated application entry point
import { LocationProvider, Router, Route } from "preact-iso";
import { render } from "preact";

// Root component (from _root.tsx or default)
import { Root } from "/absolute/path/to/_root.tsx";

// 404 component (from _404.tsx or default)
import { NotFound } from "/absolute/path/to/_404.tsx";

// Page components discovered during build (aliases use path-based PascalCase)
import { Page as DashboardPage } from "/absolute/path/to/dashboard.tsx";
import { Page as SettingsPage } from "/absolute/path/to/settings.tsx";
import { Page as UsersUseridPage } from "/absolute/path/to/users/:userid.tsx";
// ... more pages

function App() {
  return (
    <Root>
      <LocationProvider>
        <Router>
          <Route path="/dashboard" component={DashboardPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/users/:userid" component={UsersUseridPage} />
          {/* ... more routes */}
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
```

### Component Alias Generation

Component aliases are generated using **path-based PascalCase** to ensure uniqueness:

| Path | Alias |
|------|-------|
| `/dashboard` | `DashboardPage` |
| `/users/:userid` | `UsersUseridPage` |
| `/settings/profile` | `SettingsProfilePage` |
| `/api/v1/health` | `ApiV1HealthPage` |

The algorithm:
1. Split path by `/` and `:`
2. Capitalize each segment
3. Join and append `Page` suffix

### ts-morph Code Generation

Instead of string manipulation, we use ts-morph to programmatically generate the application file:

```typescript
import { Project, SourceFile, ts } from "@ts-morph/ts-morph";

async function generateClientApp(
  pages: ClientPageEntry[],
  specialFiles: SpecialFiles,
): Promise<string> {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "preact",
    },
  });

  const sourceFile = project.createSourceFile("app.tsx");

  // Add preact-iso imports
  sourceFile.addImportDeclaration({
    moduleSpecifier: "preact-iso",
    namedImports: ["LocationProvider", "Router", "Route"],
  });

  sourceFile.addImportDeclaration({
    moduleSpecifier: "preact",
    namedImports: ["render"],
  });

  // Add root component import
  if (specialFiles.root) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: specialFiles.root.absolutePath,
      namedImports: ["Root"],
    });
  }

  // Add 404 component import
  if (specialFiles.notFound) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: specialFiles.notFound.absolutePath,
      namedImports: ["NotFound"],
    });
  }

  // Add page component imports (using discovered export names)
  for (const page of pages) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: page.absolutePath,
      namedImports: [{ name: page.componentExportName, alias: page.componentAlias }],
    });
  }

  // Generate App component with JSX
  // ts-morph handles JSX through addStatements with string content
  // which is then properly parsed and formatted
  sourceFile.addStatements(`
${specialFiles.root ? '' : 'function Root({ children }) { return <>{children}</>; }'}
${specialFiles.notFound ? '' : 'function NotFound() { return <div><h1>404</h1><p>Page not found</p></div>; }'}

function App() {
  return (
    <Root>
      <LocationProvider>
        <Router>
          ${pages.map(p => `<Route path="${p.pathname}" component={${p.componentAlias}} />`).join("\n          ")}
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
  return sourceFile.getFullText();
}
```

### Index HTML Generation

The index HTML is generated by rendering the `index_page` component to string using
preact's `renderToString`. If no `_index.tsx` is provided, a default component is used:

```typescript
import { renderToString } from "preact-render-to-string";

// Default index page component
function DefaultIndexPage({ scripts, styles, title }: IndexPageParameters) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {styles.map((href) => <link rel="stylesheet" href={href} />)}
      </head>
      <body>
        {scripts.map((src) => <script type="module" src={src} />)}
      </body>
    </html>
  );
}

function generateIndexHtml(
  indexPage: IndexPage | null,
  params: IndexPageParameters,
): string {
  const component = indexPage?.component ?? DefaultIndexPage;
  return "<!DOCTYPE html>" + renderToString(component(params));
}
```

### Asset Paths

Bundled client assets are served from the **root with content hashes** for
cache busting:

```
/app-a1b2c3d4.js
/style-e5f6g7h8.css
```

The content hash is derived from the file contents, ensuring browsers fetch
new versions when the bundle changes while allowing aggressive caching.

---

## Type Definitions

### ClientPage Token

```typescript
import type { FunctionComponent } from "preact";

const ClientPageSymbol = "CLIENT_PAGE" as const;
type ClientPageSymbol = typeof ClientPageSymbol;

/**
 * Marker type for client page routes.
 * Files with this as default export are included in the SPA router.
 *
 * @since 0.3.0
 */
export type ClientPage = {
  readonly type: ClientPageSymbol;
  readonly title: string;
  readonly component: FunctionComponent;
};

/**
 * Creates a client page marker.
 * The component reference is used with object equality to find the export name.
 *
 * @example
 * ```tsx
 * // routes/dashboard.tsx
 * import { client_page } from "@baetheus/pick/builder";
 *
 * export function Page() {
 *   return <div>Dashboard</div>;
 * }
 *
 * export default client_page("Dashboard", Page);
 * ```
 *
 * @since 0.3.0
 */
export function client_page(
  title: string,
  component: FunctionComponent,
): ClientPage {
  return { type: ClientPageSymbol, title, component };
}

/**
 * Type guard for ClientPage.
 *
 * @since 0.3.0
 */
export function is_client_page(value: unknown): value is ClientPage {
  return Ref.isRecord(value) &&
    "type" in value &&
    value.type === ClientPageSymbol;
}
```

### IndexPage Token

```typescript
import type { FunctionComponent } from "preact";

const IndexPageSymbol = "INDEX_PAGE" as const;
type IndexPageSymbol = typeof IndexPageSymbol;

/**
 * Parameters passed to the index page component during HTML generation.
 *
 * @since 0.3.0
 */
export type IndexPageParameters = {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly title: string;
};

/**
 * Marker type for the index page HTML shell.
 * The component is rendered to string to generate the HTML document.
 *
 * @since 0.3.0
 */
export type IndexPage = {
  readonly type: IndexPageSymbol;
  readonly component: FunctionComponent<IndexPageParameters>;
};

/**
 * Creates an index page marker.
 * The component receives script/style paths and renders the HTML shell.
 *
 * @example
 * ```tsx
 * // routes/_index.tsx
 * import { index_page, type IndexPageParameters } from "@baetheus/pick/builder";
 *
 * function Shell({ scripts, styles, title }: IndexPageParameters) {
 *   return (
 *     <html>
 *       <head>
 *         <title>{title}</title>
 *         {styles.map((href) => <link rel="stylesheet" href={href} />)}
 *       </head>
 *       <body>
 *         {scripts.map((src) => <script type="module" src={src} />)}
 *       </body>
 *     </html>
 *   );
 * }
 *
 * export default index_page(Shell);
 * ```
 *
 * @since 0.3.0
 */
export function index_page(
  component: FunctionComponent<IndexPageParameters>,
): IndexPage {
  return { type: IndexPageSymbol, component };
}

/**
 * Type guard for IndexPage.
 *
 * @since 0.3.0
 */
export function is_index_page(value: unknown): value is IndexPage {
  return Ref.isRecord(value) &&
    "type" in value &&
    value.type === IndexPageSymbol;
}
```

### Internal Entry Types

```typescript
/**
 * Entry representing a detected client page during directory walk.
 *
 * @since 0.3.0
 */
type ClientPageEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly pathname: string;
  readonly title: string;
  readonly componentAlias: string;
  readonly componentExportName: string; // Found via object equality
};

/**
 * Special files detected during directory walk.
 *
 * @since 0.3.0
 */
type SpecialFiles = {
  readonly root: { absolutePath: string } | null;
  readonly indexPage: IndexPage | null;
  readonly notFound: { absolutePath: string } | null;
};

/**
 * Result of client build phase.
 *
 * @since 0.3.0
 */
type ClientBuildResult = {
  readonly generatedAppPath: string;
  readonly bundleResult: BundleResult;
  readonly indexHtml: string;
};
```

---

## Build Process

### Phase 1: Directory Walk

During directory walk, the builder:

1. Processes server routes as before
2. For files with client extensions (`.tsx`):
   - Detects special files (`_root.tsx`, `_index.tsx`, `_404.tsx`)
   - Detects `client_page` exports
   - Finds the component export name using object equality
3. Processes static routes as before
4. **Validates for route conflicts** (see below)

```typescript
async function detectClientPage(
  entry: FileEntry,
  config: SiteConfig,
): Promise<Either<Err.AnyErr, Option<ClientPageEntry>>> {
  // Skip non-tsx files
  if (entry.extension !== ".tsx") {
    return Either.right(O.none);
  }

  // Import module
  const [result] = await safe_import(entry.absolutePath);
  if (result.tag === "Left") {
    return Either.right(O.none);
  }

  const exports = result.right;

  // Check for client_page export
  if (!("default" in exports) || !is_client_page(exports.default)) {
    return Either.right(O.none);
  }

  const clientPage = exports.default as ClientPage;

  // Find the export name by object equality
  const componentExportName = findExportNameByEquality(
    exports,
    clientPage.component,
  );
  if (componentExportName === null) {
    return Either.left(
      route_build_error(
        "client_page component must be exported from the same module",
        { path: entry.absolutePath }
      )
    );
  }

  const pathname = parse_path(entry.relativePath, [".tsx"]);
  const componentAlias = generateComponentAlias(pathname);

  return Either.right(O.some({
    absolutePath: entry.absolutePath,
    relativePath: entry.relativePath,
    pathname,
    title: clientPage.title,
    componentAlias,
    componentExportName,
  }));
}

/**
 * Find the export name of a value by object equality.
 */
function findExportNameByEquality(
  exports: Record<string, unknown>,
  target: unknown,
): string | null {
  for (const [name, value] of Object.entries(exports)) {
    if (value === target) {
      return name;
    }
  }
  return null;
}

/**
 * Generate a PascalCase alias from a pathname.
 */
function generateComponentAlias(pathname: string): string {
  return pathname
    .split(/[\/:]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("") + "Page";
}
```

### Route Conflict Detection

The builder validates that no duplicate GET routes exist:

1. **Client page vs server route**: If a client page path matches a server GET
   route, emit a build error. Non-GET server routes (POST, PUT, etc.) can
   coexist with client pages.

2. **Server route vs server route**: If multiple GET routes exist for the same
   path (even in the same file), emit a build error.

```typescript
type RouteConflict = {
  readonly path: string;
  readonly method: string;
  readonly sources: readonly string[];
};

function detectRouteConflicts(
  serverRoutes: ServerRouteEntry[],
  clientPages: ClientPageEntry[],
): RouteConflict[] {
  const conflicts: RouteConflict[] = [];
  const getRoutes = new Map<string, string[]>();

  // Collect all GET routes
  for (const route of serverRoutes) {
    if (route.method === "GET") {
      const sources = getRoutes.get(route.pathname) ?? [];
      sources.push(route.absolutePath);
      getRoutes.set(route.pathname, sources);
    }
  }

  // Check client pages against GET routes
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

  // Check for duplicate GET server routes
  for (const [pathname, sources] of getRoutes) {
    if (sources.length > 1) {
      conflicts.push({
        path: pathname,
        method: "GET",
        sources,
      });
    }
  }

  return conflicts;
}
```

### Phase 2: Application Generation

After directory walk:

1. Validate for route conflicts
2. Generate the application TSX using ts-morph
3. Write to a temp file using `Deno.makeTempFile()`
4. Bundle using esbuild with content hashing
5. Generate index HTML using index_page component

```typescript
async function buildClientApplication(
  pages: ClientPageEntry[],
  specialFiles: SpecialFiles,
  config: ClientConfig,
): Promise<Either<Err.AnyErr, ClientBuildResult>> {
  // Generate application code using ts-morph
  const appCode = await generateClientApp(pages, specialFiles);

  // Create temp file
  const tempPath = await Deno.makeTempFile({ suffix: ".tsx" });
  await Deno.writeTextFile(tempPath, appCode);

  try {
    // Bundle with esbuild (output filenames include content hash)
    const bundleResult = await esbuildBundle(tempPath, {
      ...config,
      entryNames: "[name]-[hash]",
    });
    if (bundleResult.tag === "Left") {
      return bundleResult;
    }

    // Collect asset paths (root-relative with content hashes)
    const scripts = bundleResult.right.files
      .filter(f => f.path.endsWith(".js"))
      .map(f => "/" + f.path);
    const styles = bundleResult.right.files
      .filter(f => f.path.endsWith(".css"))
      .map(f => "/" + f.path);

    // Generate index HTML using index_page component
    const indexHtml = generateIndexHtml(specialFiles.indexPage, {
      title: config.title ?? "App",
      scripts,
      styles,
    });

    return Either.right({
      generatedAppPath: tempPath,
      bundleResult: bundleResult.right,
      indexHtml,
    });
  } finally {
    // Cleanup temp file
    await Deno.remove(tempPath).catch(() => {});
  }
}
```

### Phase 3: Route Creation

Create routes for:

1. Bundled assets (JS, CSS) with immutable caching headers
2. Index HTML at `/` and `/index.html`
3. Catch-all route for client-side routing

```typescript
function createClientRoutes<D>(
  buildResult: ClientBuildResult,
  tools: BuilderTools,
): SiteRoutes<D> {
  const clientRoutes: ClientRoute[] = [];

  // Asset routes
  for (const file of buildResult.bundleResult.files) {
    const ext = tools.extname(file.path);
    const mimeType = tools.mime_type(ext);
    const handler = create_asset_handler<D>(file.contents, mimeType);
    clientRoutes.push(
      client_route(
        buildResult.generatedAppPath,
        R.route("GET", file.path, handler) as R.Route,
        "client_asset_builder",
      ),
    );
  }

  // HTML handler
  const htmlHandler = create_html_handler<D>(buildResult.indexHtml);

  // Index routes
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

  // Catch-all for client-side routing (SPA fallback)
  // Matches any path that doesn't match server/static routes
  clientRoutes.push(
    client_route(
      buildResult.generatedAppPath,
      R.route("GET", "*", htmlHandler) as R.Route,
      "client_spa_fallback",
    ),
  );

  return site_routes<D>({ client_routes: clientRoutes });
}
```

---

## SiteConfig Changes

The bundler parameter is removed from `SiteConfig`. Instead, esbuild configuration is provided directly:

```typescript
/**
 * Configuration for client builds.
 *
 * @since 0.3.0
 */
export type ClientConfig = {
  /** Enable client SPA building (default: false) */
  readonly enabled?: boolean;
  /** Minify output (default: true in production) */
  readonly minify?: boolean;
  /** Generate source maps (default: false) */
  readonly sourcemap?: boolean | "inline" | "external";
  /** Target environments (default: ["es2020"]) */
  readonly target?: string[];
  /** Path to deno.json for import map resolution */
  readonly configPath?: string;
  /** App title for index.html */
  readonly title?: string;
};

/**
 * Configuration for the site builder.
 *
 * @since 0.3.0
 */
export type SiteConfig<D = unknown> = {
  readonly root_path: string;
  readonly tools: BuilderTools;
  readonly state: D;
  readonly middlewares?: readonly R.Middleware<D>[];
  readonly server_extensions?: readonly string[];
  readonly static_ignore?: readonly string[];
  // Replaces bundler parameter
  readonly client?: ClientConfig;
};
```

---

## Default Components

### Default Root Component

If `_root.tsx` is not provided:

```tsx
// Default root - just renders children
export function Root({ children }: { children: preact.ComponentChildren }) {
  return <>{children}</>;
}
```

### Default 404 Component

If `_404.tsx` is not provided:

```tsx
// Default 404 page
export function NotFound() {
  return (
    <div style={{ textAlign: "center", padding: "2rem" }}>
      <h1>404</h1>
      <p>Page not found</p>
    </div>
  );
}
```

---

## Migration Guide

### Breaking Changes

1. `client_root()` and `client_redirect()` are removed
2. `bundler` parameter removed from `SiteConfig`
3. `ClientIndexCreator` pattern replaced with built-in index.html generation
4. Multiple SPA bundles per build no longer supported

### Migration Steps

**Before (0.2.x):**

```tsx
// routes/client.tsx
import { client_root } from "@baetheus/pick/builder";
import { render } from "preact";
import { App } from "./App.tsx";

export default client_root(({ scripts, styles, baseUrl }) => `
<!DOCTYPE html>
<html>
<head>
  <base href="${baseUrl}">
  ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join("")}
</head>
<body>
  <div id="app"></div>
  ${scripts.map(s => `<script type="module" src="${s}"></script>`).join("")}
</body>
</html>
`);

if (typeof document !== "undefined") {
  render(<App />, document.getElementById("app")!);
}
```

**After (0.3.x):**

```tsx
// routes/_index.tsx (optional - for custom HTML shell)
import { index_page, type IndexPageParameters } from "@baetheus/pick/builder";

function Shell({ scripts, styles, title }: IndexPageParameters) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="icon" href="/favicon.ico" />
        {styles.map((href) => <link rel="stylesheet" href={href} />)}
      </head>
      <body>
        {scripts.map((src) => <script type="module" src={src} />)}
      </body>
    </html>
  );
}

export default index_page(Shell);

// routes/_root.tsx (optional - for custom wrapper)
import type { ComponentChildren } from "preact";

export function Root({ children }: { children: ComponentChildren }) {
  return (
    <div class="app-container">
      <header>My App</header>
      <main>{children}</main>
    </div>
  );
}

// routes/dashboard.tsx
import { client_page } from "@baetheus/pick/builder";

export function Page() {
  return <div>Dashboard content</div>;
}

export default client_page("Dashboard", Page);

// routes/settings.tsx
import { client_page } from "@baetheus/pick/builder";

export function Page() {
  return <div>Settings content</div>;
}

export default client_page("Settings", Page);
```

**Build configuration:**

```typescript
// Before
const result = await B.build_site({
  root_path: "./routes",
  tools: deno_tools(),
  state: null,
  bundler: esbuild_deno_preact({ minify: true }),
});

// After
const result = await B.build_site({
  root_path: "./routes",
  tools: deno_tools(),
  state: null,
  client: {
    enabled: true,
    minify: true,
  },
});
```

---

## Dependencies

### New Dependencies

Add to `deno.json`:

```json
{
  "imports": {
    "@ts-morph/ts-morph": "jsr:@ts-morph/ts-morph@^27.0.2",
    "preact": "npm:preact@^10.24.0",
    "preact-iso": "npm:preact-iso@^2.6.0",
    "preact-render-to-string": "npm:preact-render-to-string@^6.5.0"
  }
}
```

### Build-time Dependencies

- `@ts-morph/ts-morph` - For generating the application entry point
- `preact-render-to-string` - For rendering the index_page component to HTML

### Bundled into Client

The generated application imports:
- `preact` - For rendering
- `preact-iso` - For LocationProvider, Router, Route

These are resolved via the esbuild bundler using `@luca/esbuild-deno-loader`.

---

## Implementation Plan

### Phase 1: Add Tokens

1. Add `ClientPage` type and `client_page()` factory
2. Add `IndexPage` type and `index_page()` factory
3. Add `is_client_page()` and `is_index_page()` type guards
4. Add `IndexPageParameters` type

### Phase 2: Add ts-morph Code Generation

1. Add `@ts-morph/ts-morph` dependency
2. Add `preact-render-to-string` dependency
3. Create `generateClientApp()` function
4. Create `generateComponentAlias()` helper
5. Create `findExportNameByEquality()` helper

### Phase 3: Add Route Conflict Detection

1. Implement `detectRouteConflicts()` function
2. Integrate into build validation
3. Emit clear error messages for conflicts

### Phase 4: Refactor Build Process

1. Add `ClientConfig` to `SiteConfig`
2. Detect special files during walk (`_root.tsx`, `_index.tsx`, `_404.tsx`)
3. Collect `ClientPageEntry` records with export names
4. Validate for route conflicts
5. Generate app using ts-morph
6. Write to temp file
7. Bundle with esbuild (content-hashed filenames)
8. Generate index HTML using `index_page` component
9. Create routes

### Phase 5: Remove Old Implementation

1. Remove `client_root()` and `ClientRoot` type
2. Remove `client_redirect()` and `ClientRedirect` type
3. Remove `bundler` parameter from `SiteConfig`
4. Remove `ClientIndexCreator` type
5. Update tests

### Phase 6: Documentation and Examples

1. Update README
2. Create example SPA application
3. Document migration path

---

## File Changes Summary

| File | Changes |
|------|---------|
| `tokens.ts` | Add ClientPage, IndexPage, and type guards |
| `builder.ts` | Import tokens, remove ClientRoot/Redirect, refactor build process |
| `platforms/deno/esbuild.ts` | Keep as internal bundler, remove public export |
| `deno.json` | Add ts-morph, preact, and preact-render-to-string dependencies |
| `testing/fixtures/` | Update test fixtures for new API |

---

## Open Questions

1. **Code splitting** - The current design bundles everything into one entry. Should we:
   - Keep single bundle (simpler)
   - Add lazy loading support via preact-iso's `lazy()` function
   - Auto-split at route boundaries

2. **CSS handling** - How should CSS be handled?
   - Bundled with JS (current behavior)
   - Separate CSS extraction
   - Support for CSS modules

3. **Hot Module Replacement** - Not addressed in this design. Consider:
   - External dev server integration
   - Built-in HMR support

---

## ts-morph Usage Details

### Project Setup

```typescript
import { Project, SourceFile, ts } from "@ts-morph/ts-morph";

function createProject(): Project {
  return new Project({
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
}
```

### Adding Imports

```typescript
function addImports(sourceFile: SourceFile, pages: ClientPageEntry[]): void {
  // Framework imports
  sourceFile.addImportDeclaration({
    moduleSpecifier: "preact-iso",
    namedImports: ["LocationProvider", "Router", "Route"],
  });

  sourceFile.addImportDeclaration({
    moduleSpecifier: "preact",
    namedImports: ["render"],
  });

  // Page imports with aliases (using discovered export names)
  for (const page of pages) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: page.absolutePath,
      namedImports: [{ name: page.componentExportName, alias: page.componentAlias }],
    });
  }
}
```

### Generating Routes

```typescript
function generateRoutes(pages: ClientPageEntry[]): string {
  return pages
    .map(page => `<Route path="${page.pathname}" component={${page.componentAlias}} />`)
    .join("\n          ");
}
```

### Complete Generation Function

```typescript
async function generateClientApp(
  pages: ClientPageEntry[],
  specialFiles: SpecialFiles,
): Promise<string> {
  const project = createProject();
  const sourceFile = project.createSourceFile("app.tsx");

  // Add framework imports
  addImports(sourceFile, pages);

  // Add root import or inline default
  if (specialFiles.root) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: specialFiles.root.absolutePath,
      namedImports: ["Root"],
    });
  }

  // Add 404 import or inline default
  if (specialFiles.notFound) {
    sourceFile.addImportDeclaration({
      moduleSpecifier: specialFiles.notFound.absolutePath,
      namedImports: ["NotFound"],
    });
  }

  // Add the App component and render call
  const routes = generateRoutes(pages);

  sourceFile.addStatements(`
${!specialFiles.root ? 'function Root({ children }) { return <>{children}</>; }' : ''}
${!specialFiles.notFound ? 'function NotFound() { return <div><h1>404</h1><p>Page not found</p></div>; }' : ''}

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

  // Format and return
  sourceFile.formatText();
  return sourceFile.getFullText();
}
```

---

## Alternative Approaches Considered

### 1. Keep Multiple SPAs

Could keep supporting multiple client roots but simplify the API. Rejected because:
- Adds complexity
- Rarely needed in practice
- Can be achieved with multiple build runs

### 2. String Templates

Could use tagged template literals instead of ts-morph. Rejected because:
- Less type-safe
- Harder to maintain
- ts-morph provides formatting, validation

### 3. AST from preact-iso

Could import preact-iso types for stronger typing. Rejected because:
- Adds runtime dependency on type analysis
- ts-morph is sufficient for code generation
