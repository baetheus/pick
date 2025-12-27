# Directory-Based Router Builder

## Overview

A generic builder for web applications that pairs a TypeScript backend with SPA
frontend(s) without managing them separately. Given a directory path, the
builder walks it and returns a Router that automatically handles:

- Static assets
- Backend routes
- Client SPA bundling and route resolution

The interfaces remain generic enough for any runtime (Deno, Bun, Node) and
frontend framework (Preact, React, Mithril, etc).

## Build Pipeline

### Phase 1: Walker

Walk a physical directory and return an iterator of `FileEntry` objects:

```ts
type FileEntry = {
  readonly stream: () => ReadableStream<Uint8Array>;
  readonly absolute_path: string;
  readonly relative_path: string;
  readonly filename: string;
  readonly extension: string;
  readonly mime_type: Option<string>;
};
```

**Implementation Notes:**

- Use platform-specific walk implementations via `BuilderTools`
- Compute `relative_path` from source directory root
- Derive `mime_type` from extension using a configurable mapping

### Phase 2: Server Build

Filter file entries by configurable extension set (default: `.ts`), then attempt
dynamic import. Successfully imported files are scanned for `PartialRoute`
exports.

**File System to Route Mapping:**

| File Path | Route Pattern |
|-----------|---------------|
| `routes/users.ts` | `/users` |
| `routes/users/index.ts` | `/users/index` |
| `routes/api/:id.ts` | `/api/:id` |
| `routes/api/:userId/posts/:postId.ts` | `/api/:userId/posts/:postId` |
| `routes/files/*.ts` | `/files/*` |

**Conventions:**

- Parameterized routes use `:param/` directory names (matches URLPattern)
- File paths map directly to routes (no index stripping)
- Wildcard routes use `*.ts` filename for catch-all segments
- Multiple exports per file supported (`get`, `post`, `put`, `delete`, etc)
- Configurable extension set via `server_extensions` option

**Conflict Detection:**

- Error on duplicate routes (e.g., two files resolving to same pattern) with the
  same specificity. Specificity is defined as the number of unique params, with
  fewer params meaning a higher specificity. A higher specificity for a matching
  route will be routed to first.
- Build fails with descriptive error message listing conflicting files

**Export Pattern:**

PartialRoute builders (`B.get`, `B.post`, etc.) accept either:

1. **Handler only** - params is `unknown`
2. **Config object** - params typed via `Schema` from `fun/schemable`

```ts
// routes/api/:userId/posts.ts
import * as B from "pick/builder";
import * as E from "fun/effect";
import { schema } from "fun/schemable";

// Simple form: handler only, params is unknown
export const get = B.get(E.gets((req, params, ctx) => {
  // params is unknown, requires manual type assertion
  const { userId } = params as { userId: string };
  return R.json(JSON.stringify({ userId }));
}));

// Config form: params typed via schema
const PostParams = schema(s => s.struct({
  userId: s.string(),
}));

export const post = B.post({
  params: PostParams,
  handler: E.gets((req, params, ctx) => {
    // params.userId is fully typed as string
    // Runtime validation occurs before handler is called
    return R.json(JSON.stringify({ userId: params.userId }));
  }),
});
```

**Config Object Shape:**

```ts
type PartialRouteConfig<P, D> = {
  readonly params: Schema<P>;           // Schema for path params
  readonly handler: Router.Handler<D>;  // Route handler
  // Future extensions: body, query, headers schemas
};
```

**Validation Behavior:**

- Schema validation runs before the handler is invoked
- Validation failure returns a 400 Bad Request with error details
- Schemas can transform params (e.g., string → number parsing)
- Without a schema (simple form), params defaults to `unknown`

**Output:** Array of `ServerRoute<D>` with file removed from queue.

### Phase 3: Client Build

Remaining files filtered by extension (configurable, default: `.ts`, `.tsx`).
Scan for client exports:

1. **Client Root Export**: `export const client` marks a file as an SPA entry
   point. Multiple roots supported for multi-SPA sites.

2. **Client Route Export**: Default export of shared client redirect object
   marks files as SPA routes that should serve the entry point's `index.html`.

**Multi-SPA Support:**

Each client root creates its own SPA bundle. Client routes are associated with
the nearest ancestor client root in the directory tree.

```
routes/
├── app/
│   ├── client.tsx          # export const client (main SPA root)
│   ├── home.tsx            # export default redirect → serves app/index.html
│   └── settings.tsx        # export default redirect → serves app/index.html
└── admin/
    ├── client.tsx          # export const client (admin SPA root)
    ├── dashboard.tsx       # export default redirect → serves admin/index.html
    └── users.tsx           # export default redirect → serves admin/index.html
```

**Bundle Strategy:**

Configurable via `bundle_strategy` option:

- `"startup"`: Build all bundles at server start, serve from memory
- `"lazy"`: Build on first request, cache in memory

**Output:**

- `ClientRoot` objects containing bundle stream and index.html stream
- Array of `ClientRoute` entries mapping paths to their root's index.html

### Phase 4: Static Build

All remaining files become static routes. Each file opened as a readable stream
with appropriate MIME type headers.

**Output:** Array of `StaticRoute` entries.

### Phase 5: Route Combination

Combine server, client, and static outputs into a single Router.

**Ordering Rules:**

1. Server routes have highest priority
2. Static routes take precedence over parameterized routes
3. Parameterized routes sorted alphabetically by parameter name
4. Client routes (SPA fallbacks) have lowest priority

**Route Conflicts:**

- Duplicate patterns within same phase: Build error
- Cross-phase conflicts (e.g., static `/users` vs server `/users`): Warn, server
  wins

## Configuration

```ts
type SiteConfig<D> = {
  readonly root_path: string;
  readonly builders: RouteBuilder<D>[];
  readonly middlewares: Router.Middleware<D>[];
  readonly tools: BuilderTools;
  readonly state: D;

  // New options
  readonly server_extensions?: readonly string[];  // default: [".ts"]
  readonly client_extensions?: readonly string[];  // default: [".ts", ".tsx"]
  readonly bundle_strategy?: "startup" | "lazy";   // default: "startup"
  readonly static_ignore?: readonly string[];      // glob patterns to ignore
};
```

## Types

```ts
type ClientRoot = {
  readonly entry_path: string;
  readonly bundle: () => ReadableStream<Uint8Array>;
  readonly index_html: () => ReadableStream<Uint8Array>;
  readonly routes: readonly string[];  // paths served by this SPA
};

type ClientRedirect = {
  readonly type: typeof ClientRedirectSymbol;
};

export const client_redirect: ClientRedirect = {
  type: ClientRedirectSymbol,
};

// Usage in route file:
// export default client_redirect;

/**
 * Config object for PartialRoute builders with typed params.
 * When this form is used, the handler receives typed params.
 */
type PartialRouteConfig<P, D> = {
  readonly params: Schema<P>;
  readonly handler: Router.Handler<D>;
};

/**
 * PartialRoute with optional schema metadata for runtime validation.
 */
type PartialRoute<D> = {
  readonly type: PartialRouteSymbol;
  readonly method: Router.Methods;
  readonly handler: Router.Handler<D>;
  readonly params_schema: Option<Schema<unknown>>;
};

/**
 * Builder function signature supporting both forms:
 * - get(handler) → params is unknown
 * - get({ params, handler }) → params is TypeOf<typeof params>
 */
type PartialRouteBuilder = {
  <D>(handler: Router.Handler<D>): PartialRoute<D>;
  <P, D>(config: PartialRouteConfig<P, D>): PartialRoute<D>;
};
```

## Implementation Tasks

### Task 1: Enhanced FileEntry

Update `FileEntry` type to include all metadata needed for build phases:

- Add `stream` factory function
- Add `mime_type` field
- Ensure `relative_path` is computed from root directory

### Task 2: Path Parser

Create a path parser that converts filesystem paths to URLPattern pathnames:

- Handle `:param/` directories → `:param` segments
- Handle `*.ts` → `*` wildcard
- Strip `.ts`/`.tsx` extensions
- Direct path mapping (no index stripping)
- Detect and error on conflicts

### Task 3: PartialRoute Builders with Schema Support

Refactor PartialRoute builders (`get`, `post`, etc.) to support both forms:

- Simple form: `get(handler)` with `unknown` params
- Config form: `get({ params, handler })` with typed params
- Store `params_schema` as `Option<Schema>` on PartialRoute
- Runtime validation wrapper that decodes params before handler invocation
- Return 400 Bad Request on validation failure with decode errors

### Task 4: Server Route Builder

Refactor `server_route_builder` to:

- Support configurable extensions
- Extract all `PartialRoute` exports from a file
- Generate proper route paths using path parser
- Track built paths for conflict detection
- Wrap handlers with schema validation when `params_schema` is `Some`

### Task 5: Client Route Builder

Implement `client_route_builder`:

- Detect `export const client` for SPA roots
- Detect default export of `client_redirect` for SPA pages
- Associate pages with nearest ancestor root
- Generate bundles using configurable bundler tool

### Task 6: Static Route Builder

Refactor `static_route_builder`:

- Add MIME type detection
- Support ignore patterns
- Stream files lazily

### Task 7: Route Combiner

Implement `combine_routes`:

- Sort by specificity
- Detect cross-phase conflicts
- Generate final Router

## Stretch Goals

### Stretch 1: Build Output Mode

Alternative mode to output the full application to a directory instead of
serving:

```ts
type BuildOutput = {
  readonly server_bundle: string;      // compiled server code
  readonly client_bundles: string[];   // one per SPA
  readonly static_assets: string[];    // copied files
  readonly manifest: BuildManifest;    // metadata
};
```

### Stretch 2: Dev Mode

Watch mode with hot reload:

- File watcher integration
- WebSocket-based refresh injection
- Incremental rebuilds
- Source map support

### Stretch 3: OpenAPI Generation

Generate OpenAPI specs from routes:

- Extract schemas from route type parameters
- Support JSDoc-based annotations
- Output swagger.json/openapi.yaml

## Coding Style

Following `fun` library conventions:

- JSDoc blocks with `@example` and `@since` tags
- Type definitions precede implementations
- Curried functions for composition
- `Option` for nullable values, `Either` for errors
- `Effect` for async operations with error handling
- Snake_case for functions, PascalCase for types
- Descriptive function names: verbs for actions, nouns for constructors

## Open Questions

1. **Bundler Integration**: How should the bundler be abstracted? Current
   thinking is a `bundle` function in `BuilderTools`:

   ```ts
   bundle: (entry: string, options: BundleOptions) => Promise<ReadableStream>;
   ```

2. **Source Maps**: Should source maps be generated and served in dev mode?
   What path should they use?

3. **Asset Hashing**: Should static assets get content hashes for cache
   busting? If so, how should the manifest be exposed to client code?

4. **SSR Support**: Should server routes be able to render client components?
   This adds complexity but enables hybrid rendering.
