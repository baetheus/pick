import type { ComponentChildren, FunctionComponent } from "preact";
import type { Schema } from "@baetheus/fun/schemable";

import * as Option from "@baetheus/fun/option";
import * as Refinement from "@baetheus/fun/refinement";

import type { Handler, Methods } from "./router.ts";

const PartialRouteSymbol = "PARTIAL_ROUTE" as const;
type PartialRouteSymbol = typeof PartialRouteSymbol;

/**
 * Config object for PartialRoute builders with typed params.
 *
 * @since 0.1.0
 */
export type PartialRouteConfig<P> = {
  readonly params: Schema<P>;
  readonly handler: Handler;
};

/**
 * A partial route definition containing method, handler, and optional schema.
 *
 * @since 0.1.0
 */
export type PartialRoute = {
  readonly type: PartialRouteSymbol;
  readonly method: Methods;
  readonly handler: Handler;
  readonly params_schema: Option.Option<Schema<unknown>>;
};

/**
 * Creates a PartialRoute with the given method and handler.
 *
 * @since 0.1.0
 */
export function partial_route(
  method: Methods,
  handler: Handler,
  params_schema: Option.Option<Schema<unknown>> = Option.none,
): PartialRoute {
  return { type: PartialRouteSymbol, method, handler, params_schema };
}

/**
 * Type guard for PartialRoute.
 *
 * @since 0.1.0
 */
export function is_partial_route(value: unknown): value is PartialRoute {
  return Refinement.isRecord(value) &&
    "type" in value &&
    value.type === PartialRouteSymbol;
}

/**
 * Function type for building partial routes from handlers.
 * Supports both simple handler form and config form with typed params.
 *
 * @since 0.2.0
 */
export type MethodBuilder = {
  (handler: Handler): PartialRoute;
  <P>(config: PartialRouteConfig<P>): PartialRoute;
};

/**
 * Checks if input is a PartialRouteConfig object.
 *
 * @since 0.1.0
 */
function is_config<P>(
  input: Handler | PartialRouteConfig<P>,
): input is PartialRouteConfig<P> {
  return Refinement.isRecord(input) && "params" in input && "handler" in input;
}

/**
 * Creates a PartialRoute builder for the given HTTP method.
 *
 * Supports two calling conventions:
 * - `method(handler)` - params is `unknown`
 * - `method({ params, handler })` - params typed via schema
 *
 * @since 0.1.0
 */
function create_method_builder(method: Methods): MethodBuilder {
  function builder(handler: Handler): PartialRoute;
  function builder<P>(config: PartialRouteConfig<P>): PartialRoute;
  function builder<P>(
    input: Handler | PartialRouteConfig<P>,
  ): PartialRoute {
    if (is_config(input)) {
      return partial_route(
        method,
        input.handler,
        Option.some(input.params as Schema<unknown>),
      );
    }
    return partial_route(method, input, Option.none);
  }
  return builder;
}

/**
 * Creates a GET route handler.
 *
 * @example
 * ```ts
 * // Simple form - params is unknown
 * export const get = B.get(E.gets((req, params, ctx) => {
 *   return R.text("Hello");
 * }));
 *
 * // Config form - params is typed
 * export const get = B.get({
 *   params: schema(s => s.struct({ id: s.string() })),
 *   handler: E.gets((req, params, ctx) => {
 *     return R.text(`ID: ${params.id}`);
 *   }),
 * });
 * ```
 *
 * @since 0.1.0
 */
export const get: MethodBuilder = create_method_builder("GET");

/**
 * Creates a POST route handler.
 *
 * @since 0.1.0
 */
export const post: MethodBuilder = create_method_builder("POST");

/**
 * Creates a PUT route handler.
 *
 * @since 0.1.0
 */
export const put: MethodBuilder = create_method_builder("PUT");

/**
 * Creates a DELETE route handler.
 *
 * @since 0.1.0
 */
export const del: MethodBuilder = create_method_builder("DELETE");

/**
 * Creates a PATCH route handler.
 *
 * @since 0.1.0
 */
export const patch: MethodBuilder = create_method_builder("PATCH");

/**
 * Creates a HEAD route handler.
 *
 * @since 0.1.0
 */
export const head: MethodBuilder = create_method_builder("HEAD");

/**
 * Creates an OPTIONS route handler.
 *
 * @since 0.1.0
 */
export const options: MethodBuilder = create_method_builder("OPTIONS");

const ClientPageSymbol = "CLIENT_PAGE" as const;
type ClientPageSymbol = typeof ClientPageSymbol;

/**
 * Marker type for client page routes.
 * Files with this as default export are included in the SPA router.
 *
 * @since 0.3.0
 */
export type ClientPage<T extends string = string, P = unknown> = {
  readonly type: ClientPageSymbol;
  readonly tag: T;
  readonly component: FunctionComponent<P>;
};

type ClientPageFactory<T extends string, P = unknown> = {
  readonly create: (component: FunctionComponent<P>) => ClientPage<T, P>;
  readonly refine: (value: unknown) => value is ClientPage<T, P>;
};

function create_client_page<T extends string, P>(
  tag: T,
): ClientPageFactory<T, P> {
  return {
    create: (component) => ({
      type: ClientPageSymbol,
      tag,
      component,
    }),
    refine: Refinement.struct({
      type: Refinement.literal(ClientPageSymbol),
      tag: Refinement.literal(tag),
      component: (c): c is FunctionComponent<P> => typeof c === "function",
    }),
  };
}

/**
 * When a ClientRoute tagged ClientPage is exported from a file it designates to
 * the client builder that the file should be built into the spa client router.
 */
export const client_route: ClientPageFactory<"ClientRoute"> =
  create_client_page(
    "ClientRoute",
  );

/**
 * When a ClientDefaultRoute tagged ClientPage is exported from a file it
 * designates that route as the fallback route for the spa client.
 */
export const client_default: ClientPageFactory<"ClientDefaultRoute"> =
  create_client_page(
    "ClientDefaultRoute",
  );

export type ClientIndexParameters = {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly title: string;
};

/**
 * When a ClientIndex tagged ClientPage is exported from a file it designates to
 * the client buidler that the file should be used to construct the root
 * index.html static file and the default / route for the builder application.
 */
export const client_index: ClientPageFactory<
  "ClientIndex",
  ClientIndexParameters
> = create_client_page(
  "ClientIndex",
);

export type ClientWrapperParameters = {
  readonly children: ComponentChildren;
};

/**
 * When a ClientWrapper tagged ClientPage is exported from a file it designates
 * the the constructer spa router should be nested within this component.
 */
export const client_wrapper: ClientPageFactory<
  "ClientWrapper",
  ClientWrapperParameters
> = create_client_page(
  "ClientWrapper",
);
