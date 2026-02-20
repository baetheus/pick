/**
 * OpenAPI 3.1.0 specification builder for Pick routes.
 *
 * This module provides a build-phase-only builder that generates an OpenAPI
 * specification from SiteRoutes and serves it at a configurable path.
 *
 * @module
 * @since 0.4.0
 */

import type { Schema } from "@baetheus/fun/schemable";

import * as Effect from "@baetheus/fun/effect";
import * as Option from "@baetheus/fun/option";
import * as JsonSchema from "@baetheus/fun/json_schema";
import { pipe } from "@baetheus/fun/fn";

import * as Path from "@std/path";

import type * as Builder from "./builder.ts";
import * as Router from "./router.ts";

/**
 * OpenAPI Info Object as per OpenAPI 3.1.0 specification.
 *
 * @since 0.4.0
 */
export type OpenAPIInfo = {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
};

/**
 * OpenAPI Server Object as per OpenAPI 3.1.0 specification.
 *
 * @since 0.4.0
 */
export type OpenAPIServer = {
  readonly url: string;
  readonly description?: string;
};

/**
 * Configuration options for the OpenAPI builder.
 *
 * @example
 * ```ts
 * import type { OpenAPIBuilderOptions } from "@baetheus/pick/builder_openapi";
 *
 * const options: OpenAPIBuilderOptions = {
 *   name: "MyOpenAPIBuilder",
 *   path: "/api/openapi.json",
 *   info: {
 *     title: "My API",
 *     version: "1.0.0",
 *     description: "My API description",
 *   },
 *   servers: [{ url: "https://api.example.com" }],
 * };
 * ```
 *
 * @since 0.4.0
 */
export type OpenAPIBuilderOptions = {
  readonly name?: string;
  readonly path?: string;
  readonly info: OpenAPIInfo;
  readonly servers?: readonly OpenAPIServer[];
};

/**
 * OpenAPI Parameter Object (simplified).
 *
 * @since 0.4.0
 */
type ParameterObject = {
  readonly name: string;
  readonly in: "path" | "query" | "header" | "cookie";
  readonly required?: boolean;
  readonly schema?: JsonSchema.JsonSchema;
  readonly description?: string;
};

/**
 * OpenAPI Request Body Object (simplified).
 *
 * @since 0.4.0
 */
type RequestBodyObject = {
  readonly required?: boolean;
  readonly content: {
    readonly [mediaType: string]: {
      readonly schema: JsonSchema.JsonSchema;
    };
  };
};

/**
 * OpenAPI Response Object (simplified).
 *
 * @since 0.4.0
 */
type ResponseObject = {
  readonly description: string;
  readonly content?: {
    readonly [mediaType: string]: {
      readonly schema?: JsonSchema.JsonSchema;
    };
  };
};

/**
 * OpenAPI Operation Object (simplified).
 *
 * @since 0.4.0
 */
type OperationObject = {
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly ParameterObject[];
  readonly requestBody?: RequestBodyObject;
  readonly responses: {
    readonly [statusCode: string]: ResponseObject;
  };
};

/**
 * OpenAPI Path Item Object (simplified).
 *
 * @since 0.4.0
 */
type PathItemObject = {
  readonly get?: OperationObject;
  readonly post?: OperationObject;
  readonly put?: OperationObject;
  readonly delete?: OperationObject;
  readonly patch?: OperationObject;
  readonly head?: OperationObject;
  readonly options?: OperationObject;
};

/**
 * JSON Schema (simplified subset for OpenAPI 3.1.0).
 *
 * @since 0.4.0
 */
type JsonSchema = {
  readonly type?: string;
  readonly properties?: { readonly [key: string]: JsonSchema };
  readonly items?: JsonSchema.JsonSchema;
  readonly required?: readonly string[];
  readonly description?: string;
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly $ref?: string;
};

/**
 * OpenAPI 3.1.0 Document.
 *
 * @since 0.4.0
 */
type OpenAPIDocument = {
  readonly openapi: "3.1.0";
  readonly info: OpenAPIInfo;
  readonly servers?: readonly OpenAPIServer[];
  readonly paths: { readonly [path: string]: PathItemObject };
};

/**
 * Converts a Pick pathname with `:param` syntax to OpenAPI `{param}` syntax.
 *
 * @example
 * ```ts
 * convertPathToOpenAPI("/users/:id"); // "/users/{id}"
 * convertPathToOpenAPI("/posts/:postId/comments/:commentId"); // "/posts/{postId}/comments/{commentId}"
 * ```
 *
 * @since 0.4.0
 */
function convertPathToOpenAPI(pathname: string): string {
  return pathname.replace(/:([^/]+)/g, "{$1}");
}

/**
 * Extracts path parameter names from a Pick pathname.
 *
 * @example
 * ```ts
 * extractPathParameters("/users/:id"); // ["id"]
 * extractPathParameters("/posts/:postId/comments/:commentId"); // ["postId", "commentId"]
 * ```
 *
 * @since 0.4.0
 */
function extractPathParameters(pathname: string): string[] {
  const matches = pathname.match(/:([^/]+)/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1));
}

/**
 * Converts a @baetheus/fun/schemable Schema to a JSON Schema object.
 * This is a basic implementation that handles common schema types.
 *
 * @since 0.4.0
 */
function schemaToJsonSchema<A>(schema: Schema<A>): JsonSchema.JsonSchema {
  const JsonBuilder = schema(JsonSchema.SchemableJsonBuilder);
  return JsonSchema.print(JsonBuilder);
}

/**
 * Converts an HTTP method to lowercase for OpenAPI path item keys.
 *
 * @since 0.4.0
 */
function methodToLowerCase(
  method: Router.Methods,
): "get" | "post" | "put" | "delete" | "patch" | "head" | "options" {
  const lower = method.toLowerCase();
  if (
    lower === "get" || lower === "post" || lower === "put" ||
    lower === "delete" || lower === "patch" || lower === "head" ||
    lower === "options"
  ) {
    return lower;
  }
  // Fallback for WebDAV and other methods - treat as GET for OpenAPI purposes
  return "get";
}

/**
 * Generates an operation ID from the route method and pathname.
 *
 * @since 0.4.0
 */
function generateOperationId(method: string, pathname: string): string {
  const sanitizedPath = pathname
    .replace(/^\//, "")
    .replace(/[{}:]/g, "")
    .replace(/\//g, "_")
    .replace(/-/g, "_");
  return `${method.toLowerCase()}_${sanitizedPath || "root"}`;
}

/**
 * Builds an OpenAPI operation object from a FullRoute.
 *
 * @since 0.4.0
 */
function buildOperationObject(route: Builder.FullRoute): OperationObject {
  const pathParams = extractPathParameters(route.route.pathname);

  // Build parameters array
  const parameters: ParameterObject[] = pathParams.map((name) => ({
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" },
  }));

  // If we have a params_schema, try to use it for additional schema info
  pipe(
    route.params_schema,
    Option.map((schema) => {
      // We have a schema but can't easily introspect it
      // The parameters are already extracted from the path
      return schema;
    }),
  );

  // Build request body if body_schema is present
  const requestBody = pipe(
    route.body_schema,
    Option.map((schema): RequestBodyObject => ({
      required: true,
      content: {
        "application/json": {
          schema: schemaToJsonSchema(schema),
        },
      },
    })),
    Option.toUndefined,
  );

  // Build response object
  const responseSchema = pipe(
    route.output_schema,
    Option.map(schemaToJsonSchema),
    Option.toUndefined,
  );

  const responses: { [statusCode: string]: ResponseObject } = {
    "200": {
      description: "Successful response",
      ...(responseSchema
        ? {
          content: {
            "application/json": {
              schema: responseSchema,
            },
          },
        }
        : {}),
    },
  };

  return {
    operationId: generateOperationId(route.route.method, route.route.pathname),
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody,
    responses,
  };
}

/**
 * Creates an OpenAPI builder that generates an OpenAPI 3.1.0 specification
 * from all routes and serves it at a configurable path.
 *
 * This is a build-phase-only builder - it doesn't process individual files,
 * but instead receives all routes from other builders in `process_build`
 * and generates a single route serving the OpenAPI spec.
 *
 * @example
 * ```ts
 * import { openapi_builder } from "@baetheus/pick/builder_openapi";
 *
 * const builder = openapi_builder({
 *   info: {
 *     title: "My API",
 *     version: "1.0.0",
 *     description: "My awesome API",
 *   },
 *   servers: [
 *     { url: "https://api.example.com", description: "Production" },
 *   ],
 * });
 * ```
 *
 * @since 0.4.0
 */
export function openapi_builder(
  {
    name = "OpenAPIBuilder",
    path = "/openapi.json",
    info,
    servers,
  }: OpenAPIBuilderOptions,
): Builder.Builder {
  return {
    name,
    // Build-phase only - no file processing
    process_file: () => Effect.right([]),
    process_build: (routes) =>
      Effect.right([
        {
          builder: name,
          absolute_path: path,
          parsed_path: Path.parse(path),
          route: Router.route(
            "GET",
            path,
            Effect.gets(() => {
              // Build paths object from routes
              const paths: { [path: string]: PathItemObject } = {};

              for (const route of routes) {
                // Skip the OpenAPI route itself
                if (route.builder === name) continue;

                const openApiPath = convertPathToOpenAPI(route.route.pathname);
                const method = methodToLowerCase(route.route.method);
                const operation = buildOperationObject(route);

                // Initialize path item if needed
                if (!paths[openApiPath]) {
                  paths[openApiPath] = {};
                }

                // Add operation to path item (need to cast to mutable)
                (paths[openApiPath] as { [key: string]: OperationObject })[
                  method
                ] = operation;
              }

              // Build the OpenAPI document
              const document: OpenAPIDocument = {
                openapi: "3.1.0",
                info,
                ...(servers && servers.length > 0 ? { servers } : {}),
                paths,
              };

              return Router.json(JSON.stringify(document, null, 2));
            }),
          ),
          params_schema: Option.none,
          body_schema: Option.none,
          output_schema: Option.none,
        },
      ]),
  };
}
