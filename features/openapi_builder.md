# OpenAPI Builder Implementation Plan

## Overview

Create a new build-phase-only builder that generates an OpenAPI 3.1.0
specification from SiteRoutes and serves it at a configurable path.

## Changes Required

### 1. Extend `PartialRoute` in `tokens.ts`

Add optional `body_schema` and `output_schema` fields:

```typescript
export type PartialRoute = {
  readonly type: PartialRouteSymbol;
  readonly method: Methods;
  readonly handler: Handler;
  readonly params_schema: Option.Option<Schema<unknown>>;
  readonly body_schema: Option.Option<Schema<unknown>>; // NEW
  readonly output_schema: Option.Option<Schema<unknown>>; // NEW
};
```

Update `partial_route()` function and `create_method_builder()` to accept these
new fields.

Update `PartialRouteConfig` type to include optional body and output schemas.

### 2. Extend `FullRoute` in `builder.ts`

Add schema fields to preserve type information:

```typescript
export type FullRoute = {
  readonly builder: string;
  readonly absolute_path: string;
  readonly parsed_path: Path.ParsedPath;
  readonly route: Router.Route;
  readonly params_schema: Option.Option<Schema<unknown>>; // NEW
  readonly body_schema: Option.Option<Schema<unknown>>; // NEW
  readonly output_schema: Option.Option<Schema<unknown>>; // NEW
};
```

Update `full_route()` helper and `from_partial_route()` to pass through schema
fields.

### 3. Create `builder_openapi.ts`

New file implementing the OpenAPI builder:

**Configuration Options:**

```typescript
export type OpenAPIBuilderOptions = {
  readonly name?: string; // Default: "OpenAPIBuilder"
  readonly path?: string; // Default: "/openapi.json"
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly { url: string; description?: string }[];
};
```

**Builder Implementation:**

- `process_file`: Returns `Effect.right([])` (build-phase only)
- `process_build`:
  1. Receives all routes from other builders
  2. Converts routes to OpenAPI paths object
  3. Extracts path parameters from pathname (`:param` -> `{param}`)
  4. Uses `params_schema`, `body_schema`, `output_schema` when present
  5. Generates OpenAPI 3.1.0 spec
  6. Returns single FullRoute serving the JSON at configured path

**Path Parameter Conversion:**

- `/users/:id` -> `/users/{id}`
- Extract parameter names, generate ParameterObject entries

**Schema Conversion:**

- Convert `@baetheus/fun/schemable` Schema to JSON Schema (basic support)
- Fall back to `{ type: "string" }` for unknown schemas

## Files to Modify

| File                 | Changes                                                               |
| -------------------- | --------------------------------------------------------------------- |
| `tokens.ts`          | Add `body_schema`, `output_schema` to `PartialRoute`, update builders |
| `builder.ts`         | Add schema fields to `FullRoute`, update `from_partial_route`         |
| `builder_openapi.ts` | **NEW FILE** - OpenAPI builder implementation                         |
| `mod.ts`             | Export the new builder                                                |

## Implementation Order

1. `tokens.ts` - Extend PartialRoute with new schema fields
2. `builder.ts` - Extend FullRoute and from_partial_route
3. `builder_openapi.ts` - Create the OpenAPI builder
4. `mod.ts` - Add export

## Verification

1. Run existing tests to ensure schema field additions don't break anything:
   ```bash
   deno test
   ```

2. Create a test route with schemas and verify OpenAPI output:
   ```typescript
   import { openapi_builder } from "@baetheus/pick/builder_openapi";

   const builder = openapi_builder({
     info: { title: "Test API", version: "1.0.0" },
   });
   ```

3. Verify generated OpenAPI spec is valid JSON and contains expected routes
