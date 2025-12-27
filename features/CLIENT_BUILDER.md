# Client Builder Feature

## Overview

This feature adds a client build phase to `builder.ts` that replaces the existing client route builder with a two-phase system: client root/redirect symbol detection and client bundling.

## Goals

1. Replace the existing `client_root` and `client_redirect` symbols with new versions that support bundling
2. Add a bundler integration to the site builder
3. Generate bundled client assets as in-memory routes
4. Create a bundler-agnostic interface in `builder.ts`
5. Implement an esbuild-based bundler for Deno + Preact in `bundlers/esbuild-deno-preact.ts`

---

## Symbol Definitions

### ClientRoot

The `client_root` symbol marks a file as an SPA entry point. The file serves dual purposes:

1. **Index Creator**: Exports a function that generates the HTML index file
2. **Bundle Entrypoint**: The file itself is passed to the bundler as the client code entrypoint

```typescript
type ClientIndexConfig = {
  readonly scripts: readonly string[];  // Paths to bundled JS files
  readonly styles: readonly string[];   // Paths to bundled CSS files
  readonly baseUrl: string;             // Base URL for the client root
};

type ClientIndexCreator = (config: ClientIndexConfig) => string;

type ClientRoot = {
  readonly type: ClientRootSymbol;
  readonly createIndex: ClientIndexCreator;
};

// Factory function
function client_root(createIndex: ClientIndexCreator): ClientRoot;
```

**Usage Example:**

```tsx
// routes/app/client.tsx (default export required)
import { render } from "preact";
import { client_root } from "pick/builder";
import { App } from "./App.tsx";

export default client_root(({ scripts, styles, baseUrl }) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${baseUrl}">
  ${styles.map(s => `<link rel="stylesheet" href="${s}">`).join("\n  ")}
</head>
<body>
  <div id="app"></div>
  ${scripts.map(s => `<script type="module" src="${s}"></script>`).join("\n  ")}
</body>
</html>
`);

// Client-side code (bundled by esbuild)
if (typeof document !== "undefined") {
  render(<App />, document.getElementById("app")!);
}
```

### ClientRedirect

The `client_redirect` symbol marks a route as redirecting to a specific client root. Unlike the current singleton implementation, it now takes the imported client root as a parameter.

```typescript
type ClientRedirect = {
  readonly type: ClientRedirectSymbol;
  readonly target: ClientRoot;
};

// Factory function
function client_redirect(target: ClientRoot): ClientRedirect;
```

**Usage Example:**

```tsx
// routes/app/settings.tsx
import { client_redirect } from "pick/builder";
import clientRoot from "./client.tsx";

export default client_redirect(clientRoot);
```

---

## Bundler Interface

The bundler interface is defined in `builder.ts` and is bundler-agnostic. Specific implementations (esbuild, rollup, etc.) implement this interface.

```typescript
type OutputFile = {
  readonly path: string;           // Output path relative to site root (includes content hash)
  readonly contents: Uint8Array;   // File contents as bytes
};

type BundleResult = {
  readonly files: readonly OutputFile[];
};

type Bundler = (entrypoint: string) => Promise<Either<AnyErr, BundleResult>>;
```

**Key Points:**

- The bundler receives an absolute path to the entrypoint file
- The bundler returns paths relative to the site root (e.g., `/app/client.a1b2c3d4.js`)
- Output filenames include content hashes for cache busting (e.g., `client.a1b2c3d4.js`)
- The bundler uses `write: false` (or equivalent) to return in-memory buffers
- The builder creates static routes from the `OutputFile[]` returned

---

## SiteConfig Changes

The `SiteConfig` type is extended to accept an optional bundler:

```typescript
type SiteConfig<D = unknown> = {
  readonly root_path: string;
  readonly tools: BuilderTools;
  readonly state: D;
  readonly middlewares?: readonly Middleware<D>[];
  readonly server_extensions?: readonly string[];
  readonly client_extensions?: readonly string[];
  readonly static_ignore?: readonly string[];
  readonly bundler?: Bundler;  // NEW: Optional bundler for client builds
};
```

When `bundler` is provided, the builder will:
1. Detect client root and redirect symbols during the directory walk
2. After the walk, bundle each client root's entrypoint
3. Create routes for bundled assets
4. Generate HTML index using the client root's `createIndex` function
5. Create routes for the client root and its redirects

---

## Build Process

### Phase 1: Directory Walk

During the directory walk, the builder:

1. Processes server routes as before
2. For files with client extensions (`.ts`, `.tsx`):
   - Import the module
   - Check for `default` export
   - If `is_client_root(default)`: store in `client_roots` map (path → ClientRoot)
   - If `is_client_redirect(default)`: store in `client_redirects` array with target reference
3. Process static routes as before

```typescript
type ClientRootEntry = {
  readonly absolute_path: string;
  readonly relative_path: string;
  readonly pathname: string;
  readonly client_root: ClientRoot;
};

type ClientRedirectEntry = {
  readonly absolute_path: string;
  readonly pathname: string;
  readonly target: ClientRoot;
};
```

### Phase 2: Client Bundling

After the directory walk completes, for each client root:

1. Call `bundler(client_root_entry.absolute_path)`
2. If bundle fails, return the error
3. For each `OutputFile` in the result:
   - Create a GET route that serves the file contents
   - Set appropriate MIME type based on file extension
4. Categorize output files into scripts (`.js`) and styles (`.css`)
5. Call `client_root.createIndex({ scripts, styles, baseUrl })` to generate HTML
6. Create GET routes for the client root pathname and `/index.html` variant

### Phase 3: Client Redirects

For each client redirect:

1. Find the target client root's generated HTML handler
2. Create a GET route at the redirect's pathname that serves the same HTML

---

## esbuild-deno-preact Implementation

Located at `bundlers/esbuild-deno-preact.ts`, this implementation:

1. Uses esbuild with Deno-compatible plugins
2. Handles JSX transformation with Preact
3. Resolves Deno import maps
4. Returns browser-compatible ES modules

```typescript
import * as esbuild from "esbuild";
import * as Either from "fun/either";
import * as Err from "fun/err";
import type { Bundler, BundleResult, OutputFile } from "../builder.ts";

const bundler_error = Err.err("BundlerError");

type EsbuildDenoPreactConfig = {
  readonly minify?: boolean;
  readonly sourcemap?: boolean | "inline" | "external";
  readonly splitting?: boolean;
  readonly target?: string[];
};

export function esbuild_deno_preact(
  config: EsbuildDenoPreactConfig = {}
): Bundler {
  const {
    minify = true,
    sourcemap = false,
    splitting = false,
    target = ["es2020"],
  } = config;

  return async (entrypoint: string): Promise<Either<AnyErr, BundleResult>> => {
    try {
      const result = await esbuild.build({
        entryPoints: [entrypoint],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        minify,
        sourcemap,
        splitting,
        target,
        jsx: "automatic",
        jsxImportSource: "preact",
        // Content hash in filenames for cache busting
        entryNames: "[dir]/[name].[hash]",
        chunkNames: "[name].[hash]",
        assetNames: "[name].[hash]",
        // Deno-specific plugins for import map resolution
        plugins: [
          denoResolverPlugin(),
          denoLoaderPlugin(),
        ],
      });

      const files: OutputFile[] = result.outputFiles.map((file) => ({
        path: file.path,
        contents: file.contents,
      }));

      return Either.right({ files });
    } catch (error) {
      return Either.left(
        bundler_error("Failed to bundle client", { error, entrypoint })
      );
    }
  };
}
```

**Dependencies:**

- `esbuild` - Already in `deno.json`
- `@aspect-dev/esbuild-plugin-deno` or similar for Deno resolver/loader plugins

---

## Route Generation Details

### Bundled Asset Routes

For each `OutputFile` (filenames include content hashes, e.g., `client.a1b2c3d4.js`):

```typescript
const asset_route = R.route(
  "GET",
  output_file.path,  // e.g., "/app/client.a1b2c3d4.js"
  E.gets(() => {
    const mime = tools.mime_type(extname(output_file.path));
    const headers: [string, string][] = [];
    if (mime.tag === "Some") {
      headers.push(["Content-Type", mime.value]);
    }
    // Immutable caching enabled because content hash changes when file changes
    headers.push(["Cache-Control", "public, max-age=31536000, immutable"]);
    return new Response(output_file.contents, { headers });
  })
);
```

### Client Root HTML Routes

For each client root at pathname `/app`:

1. Route `GET /app` → serves generated HTML
2. Route `GET /app/index.html` → serves generated HTML

The HTML is pre-generated during build and stored in memory.

### Client Redirect Routes

For each redirect pointing to a client root:

1. Route at redirect pathname → serves the target client root's HTML

---

## Error Handling

New error types:

```typescript
export const client_bundle_error = Err.err("ClientBundleError");
export const client_root_not_found_error = Err.err("ClientRootNotFoundError");
```

The builder should fail fast if:

1. Bundler returns an error
2. A client redirect references a non-existent client root
3. A client root's `createIndex` function throws

---

## Migration from Current Implementation

### Breaking Changes

1. `client_root(component)` signature changes to `client_root(createIndex)`
2. `client_redirect` singleton becomes `client_redirect(target)` factory
3. `index_html_path` config option is removed (HTML is now generated)

### Migration Path

```typescript
// Before
export const client = B.client_root(<App />);

// After
export default B.client_root(({ scripts, styles }) => `
<!DOCTYPE html>
<html>
<head>${styles.map(s => `<link rel="stylesheet" href="${s}">`).join("")}</head>
<body>
  <div id="app"></div>
  ${scripts.map(s => `<script type="module" src="${s}"></script>`).join("")}
</body>
</html>
`);

// Client render code
if (typeof document !== "undefined") {
  render(<App />, document.getElementById("app")!);
}
```

---

## File Structure

```
pick/
├── builder.ts              # Updated with bundler interface and client build phase
├── bundlers/
│   └── esbuild-deno-preact.ts  # esbuild implementation for Deno + Preact
└── examples/
    └── client-app/         # Example SPA with client builder
        ├── main.ts
        └── routes/
            ├── api/
            │   └── users.ts
            └── app/
                ├── client.tsx      # Client root (default export)
                ├── App.tsx         # Preact app component
                └── settings.tsx    # Client redirect
```

---

## Design Decisions

### Content Hashing

Bundled assets include content hashes in filenames for cache busting (e.g., `client.a1b2c3d4.js`). This enables:

- Aggressive caching with `Cache-Control: public, max-age=31536000, immutable`
- Automatic cache invalidation when content changes
- Safe deployment without cache purging

The esbuild implementation uses `entryNames`, `chunkNames`, and `assetNames` patterns:

```typescript
entryNames: "[dir]/[name].[hash]",
chunkNames: "[name].[hash]",
assetNames: "[name].[hash]",
```

### No Development Mode

There is no special development mode that skips bundling. The same bundling process runs in all environments. Users who need faster iteration should:

- Use the bundler's `minify: false` option
- Enable source maps with `sourcemap: true`
- Consider using esbuild's watch mode externally for HMR workflows

### Code Splitting

Code splitting is supported as an optional parameter in the bundler config:

```typescript
type EsbuildDenoPreactConfig = {
  readonly splitting?: boolean;  // Defaults to false
  // ...
};
```

When enabled, esbuild generates chunk files which are automatically served as additional routes. Chunk filenames also include content hashes.

### CSS Handling

CSS is not extracted from JS bundles into separate files. CSS should be:

- Imported in JS and bundled inline (handled by esbuild)
- Or served as separate static files in the routes directory

### Source Maps

Source maps are configurable via the bundler config:

```typescript
type EsbuildDenoPreactConfig = {
  readonly sourcemap?: boolean | "inline" | "external";  // Defaults to false
  // ...
};
```

Options:
- `false` (default): No source maps
- `true` or `"external"`: Separate `.map` files served as additional routes
- `"inline"`: Source maps embedded in the JS files
