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
 * @example
 * ```ts
 * import type { PartialRouteConfig } from "@baetheus/pick/tokens";
 *
 * const config: PartialRouteConfig<{ id: string }> = {
 *   params: schema(s => s.struct({ id: s.string() })),
 *   handler: myHandler,
 * };
 * ```
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
 * @example
 * ```ts
 * import type { PartialRoute } from "@baetheus/pick/tokens";
 * import { get } from "@baetheus/pick/tokens";
 *
 * const route: PartialRoute = get(myHandler);
 * ```
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
 * @example
 * ```ts
 * import { partial_route } from "@baetheus/pick/tokens";
 * import * as Option from "@baetheus/fun/option";
 *
 * const route = partial_route("GET", myHandler, Option.none);
 * ```
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
 * @example
 * ```ts
 * import { is_partial_route, get } from "@baetheus/pick/tokens";
 *
 * const route = get(myHandler);
 * is_partial_route(route); // true
 * is_partial_route({}); // false
 * ```
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
 * @example
 * ```ts
 * import type { MethodBuilder } from "@baetheus/pick/tokens";
 * import { get, post } from "@baetheus/pick/tokens";
 *
 * // Both get and post are MethodBuilders
 * const getRoute = get(myHandler);
 * const postRoute = post({ params: mySchema, handler: myHandler });
 * ```
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
 * @example
 * ```ts
 * import { post } from "@baetheus/pick/tokens";
 * import * as E from "@baetheus/fun/effect";
 * import * as R from "@baetheus/pick/router";
 *
 * export const create = post(E.gets(async (req, params, ctx) => {
 *   const body = await req.json();
 *   return R.json(JSON.stringify({ created: body }), R.STATUS_CODE.Created);
 * }));
 * ```
 *
 * @since 0.1.0
 */
export const post: MethodBuilder = create_method_builder("POST");

/**
 * Creates a PUT route handler.
 *
 * @example
 * ```ts
 * import { put } from "@baetheus/pick/tokens";
 * import * as E from "@baetheus/fun/effect";
 * import * as R from "@baetheus/pick/router";
 *
 * export const update = put(E.gets(async (req, params, ctx) => {
 *   const body = await req.json();
 *   return R.json(JSON.stringify({ updated: body }));
 * }));
 * ```
 *
 * @since 0.1.0
 */
export const put: MethodBuilder = create_method_builder("PUT");

/**
 * Creates a DELETE route handler.
 *
 * @example
 * ```ts
 * import { del } from "@baetheus/pick/tokens";
 * import * as E from "@baetheus/fun/effect";
 * import * as R from "@baetheus/pick/router";
 *
 * export const remove = del(E.gets((req, params, ctx) => {
 *   return R.text("Deleted", R.STATUS_CODE.NoContent);
 * }));
 * ```
 *
 * @since 0.1.0
 */
export const del: MethodBuilder = create_method_builder("DELETE");

/**
 * Creates a PATCH route handler.
 *
 * @example
 * ```ts
 * import { patch } from "@baetheus/pick/tokens";
 * import * as E from "@baetheus/fun/effect";
 * import * as R from "@baetheus/pick/router";
 *
 * export const modify = patch(E.gets(async (req, params, ctx) => {
 *   const updates = await req.json();
 *   return R.json(JSON.stringify({ patched: updates }));
 * }));
 * ```
 *
 * @since 0.1.0
 */
export const patch: MethodBuilder = create_method_builder("PATCH");

/**
 * Creates a HEAD route handler.
 *
 * @example
 * ```ts
 * import { head } from "@baetheus/pick/tokens";
 * import * as E from "@baetheus/fun/effect";
 * import * as R from "@baetheus/pick/router";
 *
 * export const check = head(E.gets((req, params, ctx) => {
 *   return new Response(null, { status: 200 });
 * }));
 * ```
 *
 * @since 0.1.0
 */
export const head: MethodBuilder = create_method_builder("HEAD");

/**
 * Creates an OPTIONS route handler.
 *
 * @example
 * ```ts
 * import { options } from "@baetheus/pick/tokens";
 * import * as E from "@baetheus/fun/effect";
 * import * as R from "@baetheus/pick/router";
 *
 * export const cors = options(E.gets((req, params, ctx) => {
 *   return new Response(null, {
 *     headers: { "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE" }
 *   });
 * }));
 * ```
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
 * @example
 * ```ts
 * import type { ClientPage } from "@baetheus/pick/tokens";
 * import { client_route } from "@baetheus/pick/tokens";
 *
 * const MyPage = () => <div>Hello</div>;
 * export const page: ClientPage<"ClientRoute"> = client_route.create(MyPage);
 * ```
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
 * Factory for creating ClientRoute tagged pages.
 *
 * When a ClientRoute tagged ClientPage is exported from a file it designates to
 * the client builder that the file should be built into the SPA client router.
 *
 * @example
 * ```ts
 * import { client_route } from "@baetheus/pick/tokens";
 *
 * const AboutPage = () => <div>About Us</div>;
 * export const page = client_route.create(AboutPage);
 * ```
 *
 * @since 0.3.0
 */
export const client_route: ClientPageFactory<"ClientRoute"> =
  create_client_page(
    "ClientRoute",
  );

/**
 * Factory for creating ClientDefaultRoute tagged pages.
 *
 * When a ClientDefaultRoute tagged ClientPage is exported from a file it
 * designates that route as the fallback route for the SPA client.
 *
 * @example
 * ```ts
 * import { client_default } from "@baetheus/pick/tokens";
 *
 * const NotFoundPage = () => <div>404 - Page Not Found</div>;
 * export const page = client_default.create(NotFoundPage);
 * ```
 *
 * @since 0.3.0
 */
export const client_default: ClientPageFactory<"ClientDefaultRoute"> =
  create_client_page(
    "ClientDefaultRoute",
  );

/**
 * Parameters passed to ClientIndex components for rendering the HTML shell.
 *
 * @example
 * ```ts
 * import type { ClientIndexParameters } from "@baetheus/pick/tokens";
 *
 * const IndexPage = ({ scripts, styles, title }: ClientIndexParameters) => (
 *   <html>
 *     <head><title>{title}</title></head>
 *     <body><div id="app" /></body>
 *   </html>
 * );
 * ```
 *
 * @since 0.3.0
 */
export type ClientIndexParameters = {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly title: string;
};

/**
 * Factory for creating ClientIndex tagged pages.
 *
 * When a ClientIndex tagged ClientPage is exported from a file it designates to
 * the client builder that the file should be used to construct the root
 * index.html static file and the default / route for the builder application.
 *
 * @example
 * ```ts
 * import { client_index, ClientIndexParameters } from "@baetheus/pick/tokens";
 *
 * const IndexPage = ({ scripts, styles, title }: ClientIndexParameters) => (
 *   <html>
 *     <head>
 *       <title>{title}</title>
 *       {styles.map(s => <link rel="stylesheet" href={s} />)}
 *     </head>
 *     <body>
 *       <div id="app" />
 *       {scripts.map(s => <script type="module" src={s} />)}
 *     </body>
 *   </html>
 * );
 * export const index = client_index.create(IndexPage);
 * ```
 *
 * @since 0.3.0
 */
export const client_index: ClientPageFactory<
  "ClientIndex",
  ClientIndexParameters
> = create_client_page(
  "ClientIndex",
);

/**
 * Parameters passed to ClientWrapper components for wrapping the SPA router.
 *
 * @example
 * ```ts
 * import type { ClientWrapperParameters } from "@baetheus/pick/tokens";
 *
 * const AppWrapper = ({ children }: ClientWrapperParameters) => (
 *   <div class="app-container">
 *     <nav>Navigation</nav>
 *     {children}
 *     <footer>Footer</footer>
 *   </div>
 * );
 * ```
 *
 * @since 0.3.0
 */
export type ClientWrapperParameters = {
  readonly children: ComponentChildren;
};

/**
 * Factory for creating ClientWrapper tagged pages.
 *
 * When a ClientWrapper tagged ClientPage is exported from a file it designates
 * that the constructed SPA router should be nested within this component.
 *
 * @example
 * ```ts
 * import { client_wrapper, ClientWrapperParameters } from "@baetheus/pick/tokens";
 *
 * const AppWrapper = ({ children }: ClientWrapperParameters) => (
 *   <div class="app">
 *     <header>My App</header>
 *     <main>{children}</main>
 *   </div>
 * );
 * export const wrapper = client_wrapper.create(AppWrapper);
 * ```
 *
 * @since 0.3.0
 */
export const client_wrapper: ClientPageFactory<
  "ClientWrapper",
  ClientWrapperParameters
> = create_client_page(
  "ClientWrapper",
);
