/**
 * Token types for route markers.
 *
 * This module defines the marker types used by the builder to identify
 * different types of routes. These tokens are kept separate from builder.ts
 * to ensure esbuild can tree-shake builder dependencies from client bundles.
 *
 * @module
 * @since 0.3.0
 */

import type { FunctionComponent } from "preact";
import type { Schema } from "fun/schemable";
import type { Option } from "fun/option";

import * as O from "fun/option";
import * as Ref from "fun/refinement";

import type { Handler, Methods } from "./router.ts";

// #region PartialRoute Token

const PartialRouteSymbol = "PARTIAL_ROUTE" as const;
type PartialRouteSymbol = typeof PartialRouteSymbol;

/**
 * Config object for PartialRoute builders with typed params.
 *
 * @since 0.1.0
 */
export type PartialRouteConfig<P, D> = {
  readonly params: Schema<P>;
  readonly handler: Handler<D>;
};

/**
 * A partial route definition containing method, handler, and optional schema.
 *
 * @since 0.1.0
 */
export type PartialRoute<D = unknown> = {
  readonly type: PartialRouteSymbol;
  readonly method: Methods;
  readonly handler: Handler<D>;
  readonly params_schema: Option<Schema<unknown>>;
};

/**
 * Creates a PartialRoute with the given method and handler.
 *
 * @since 0.1.0
 */
export function partial_route<D = unknown>(
  method: Methods,
  handler: Handler<D>,
  params_schema: Option<Schema<unknown>> = O.none,
): PartialRoute<D> {
  return { type: PartialRouteSymbol, method, handler, params_schema };
}

/**
 * Type guard for PartialRoute.
 *
 * @since 0.1.0
 */
export function is_partial_route(value: unknown): value is PartialRoute {
  return Ref.isRecord(value) &&
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
  <D>(handler: Handler<D>): PartialRoute<D>;
  <P, D>(config: PartialRouteConfig<P, D>): PartialRoute<D>;
};

/**
 * Checks if input is a PartialRouteConfig object.
 *
 * @since 0.1.0
 */
function is_config<P, D>(
  input: Handler<D> | PartialRouteConfig<P, D>,
): input is PartialRouteConfig<P, D> {
  return Ref.isRecord(input) && "params" in input && "handler" in input;
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
  function builder<D>(handler: Handler<D>): PartialRoute<D>;
  function builder<P, D>(config: PartialRouteConfig<P, D>): PartialRoute<D>;
  function builder<P, D>(
    input: Handler<D> | PartialRouteConfig<P, D>,
  ): PartialRoute<D> {
    if (is_config(input)) {
      return partial_route(
        method,
        input.handler,
        O.some(input.params as Schema<unknown>),
      );
    }
    return partial_route(method, input, O.none);
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
export const delete_: MethodBuilder = create_method_builder("DELETE");

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
// #endregion

// #region ClientPage Token

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
 * import { client_page } from "@baetheus/pick/tokens";
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

// #endregion

// #region IndexPage Token

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
 * import { index_page, type IndexPageParameters } from "@baetheus/pick/tokens";
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

// #endregion
