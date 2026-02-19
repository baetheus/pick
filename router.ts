import type { Effect } from "@baetheus/fun/effect";

import type { StatusCode, StatusText } from "./status.ts";
import type { Header } from "./unstable-header.ts";

import * as E from "@baetheus/fun/effect";
import { match } from "@baetheus/fun/either";
import { map as mapRecord } from "@baetheus/fun/record";
import { identity, pipe } from "@baetheus/fun/fn";

import { HEADER } from "./unstable-header.ts";
import { STATUS_CODE, STATUS_TEXT } from "./status.ts";

/**
 * HTTP header constants re-exported from Deno's standard library.
 *
 * Provides easy access to common HTTP header names with proper typing.
 *
 * @example
 * ```ts
 * import { HEADER } from "./router.ts";
 *
 * const headers = new Headers();
 * headers.set(HEADER.ContentType, "application/json");
 * ```
 *
 * @since 0.1.0
 */
export { HEADER };

/**
 * HTTP status code constants re-exported from Deno's standard library.
 *
 * Provides numerical HTTP status codes for use in responses.
 *
 * @example
 * ```ts
 * import { STATUS_CODE, response_init } from "./router.ts";
 *
 * const notFoundInit = response_init(STATUS_CODE.NotFound);
 * ```
 *
 * @since 0.1.0
 */
export { STATUS_CODE };

/**
 * HTTP status text constants re-exported from Deno's standard library.
 *
 * Provides the standard text descriptions for HTTP status codes.
 *
 * @example
 * ```ts
 * import { STATUS_TEXT, STATUS_CODE } from "./router.ts";
 *
 * console.log(STATUS_TEXT[STATUS_CODE.OK]); // "OK"
 * ```
 *
 * @since 0.1.0
 */
export { STATUS_TEXT };

/**
 * Creates a ResponseInit object with the specified status, headers, and status text.
 *
 * This utility function simplifies the creation of ResponseInit objects by providing
 * sensible defaults and ensuring proper typing for status codes and headers.
 *
 * @param status - The HTTP status code for the response
 * @param headers - Optional headers to include in the response (defaults to empty array)
 * @param statusText - Optional status text (defaults to standard text for the status code)
 * @returns A ResponseInit object ready to be used with the Response constructor
 *
 * @example
 * ```ts
 * import { response_init, STATUS_CODE, HEADER } from "./router.ts";
 *
 * const init = response_init(STATUS_CODE.NotFound);
 * const initWithHeaders = response_init(
 *   STATUS_CODE.OK,
 *   [[HEADER.ContentType, "application/json"]]
 * );
 * ```
 *
 * @since 0.1.0
 */
export function response_init(
  status: StatusCode,
  headers: HeadersInit = [],
  statusText: StatusText = STATUS_TEXT[status],
): ResponseInit {
  return { status, statusText, headers };
}

/**
 * Creates a new Response with the given body and response initialization options.
 *
 * This is a convenience wrapper around the native Response constructor that provides
 * a sensible default ResponseInit with a 200 OK status.
 *
 * @param body - The body content for the response
 * @param res - Optional ResponseInit configuration (defaults to 200 OK status)
 * @returns A new Response object
 *
 * @example
 * ```ts
 * import { response, response_init, STATUS_CODE } from "./router.ts";
 *
 * const okResponse = response("Hello World");
 * const notFoundResponse = response(
 *   "Not Found",
 *   response_init(STATUS_CODE.NotFound)
 * );
 * ```
 *
 * @since 0.1.0
 */
export function response(
  body: BodyInit,
  res: ResponseInit = response_init(STATUS_CODE.OK),
): Response {
  return new Response(body, res);
}

/**
 * Creates an HTML response with the appropriate Content-Type header.
 *
 * This function automatically sets the Content-Type header to "text/html; charset=utf-8"
 * and creates a Response object with the provided HTML content.
 *
 * @param content - The HTML content to send in the response body
 * @param status - Optional HTTP status code (defaults to 200 OK)
 * @returns A Response object configured for HTML content
 *
 * @example
 * ```ts
 * import { html, STATUS_CODE } from "./router.ts";
 *
 * const homePage = html("<h1>Welcome!</h1><p>Hello World</p>");
 * const errorPage = html(
 *   "<h1>Not Found</h1><p>The page was not found</p>",
 *   STATUS_CODE.NotFound
 * );
 * ```
 *
 * @since 0.1.0
 */
export function html(
  content: BodyInit,
  status: StatusCode = STATUS_CODE.OK,
): Response {
  return response(
    content,
    response_init(status, [[HEADER.ContentType, "text/html; charset=utf-8"]]),
  );
}

/**
 * Creates a JSON response with the appropriate Content-Type header.
 *
 * This function automatically sets the Content-Type header to "application/json; charset=utf-8"
 * and creates a Response object with the provided JSON content.
 *
 * @param content - The JSON content to send in the response body
 * @param status - Optional HTTP status code (defaults to 200 OK)
 * @returns A Response object configured for JSON content
 *
 * @example
 * ```ts
 * import { json, STATUS_CODE } from "./router.ts";
 *
 * const user = { id: 1, name: "John Doe", email: "john@example.com" };
 * const userResponse = json(JSON.stringify(user));
 * const errorResponse = json(
 *   JSON.stringify({ error: "User not found" }),
 *   STATUS_CODE.NotFound
 * );
 * ```
 *
 * @since 0.1.0
 */
export function json(
  content: BodyInit,
  status: StatusCode = STATUS_CODE.OK,
): Response {
  return response(
    content,
    response_init(status, [[
      HEADER.ContentType,
      "application/json; charset=utf-8",
    ]]),
  );
}

/**
 * Creates a plain text response.
 *
 * This function creates a Response object with plain text content. The Content-Type
 * header defaults to "text/plain" as per the Response constructor's default behavior.
 *
 * @param content - The text content to send in the response body
 * @param status - Optional HTTP status code (defaults to 200 OK)
 * @returns A Response object configured for plain text content
 *
 * @example
 * ```ts
 * import { text, STATUS_CODE } from "./router.ts";
 *
 * const greeting = text("Hello, World!");
 * const error = text("Something went wrong", STATUS_CODE.InternalServerError);
 * ```
 *
 * @since 0.1.0
 */
export function text(
  content: BodyInit,
  status: StatusCode = STATUS_CODE.OK,
): Response {
  // new Response() defaults to text/plain
  return response(content, response_init(status));
}

/**
 * Creates a function that modifies headers on a Response object.
 *
 * This higher-order function takes a modification function and returns a new function
 * that applies the modification to the headers of any Response object passed to it.
 * This enables functional composition for header manipulation.
 *
 * @param modify_fn - A function that receives Headers object and modifies it
 * @returns A function that takes a Response and returns the same Response with modified headers
 *
 * @example
 * ```ts
 * import { modify_header, text, HEADER } from "./router.ts";
 *
 * const addCacheControl = modify_header((headers) => {
 *   headers.set(HEADER.CacheControl, "max-age=3600");
 * });
 *
 * const response = addCacheControl(text("Cached content"));
 * ```
 *
 * @since 0.1.0
 */
export function modify_header(
  modify_fn: (h: Headers) => void,
): (res: Response) => Response {
  return (res) => {
    modify_fn(res.headers);
    return res;
  };
}

/**
 * A tuple representing a single HTTP header as a key-value pair.
 *
 * This type defines the structure for representing an HTTP header with its name and value,
 * used in functions that manipulate multiple headers.
 *
 * @example
 * ```ts
 * import { HeaderPair, HEADER } from "./router.ts";
 *
 * const contentTypeHeader: HeaderPair = [HEADER.ContentType, "application/json"];
 * const cacheControlHeader: HeaderPair = [HEADER.CacheControl, "no-cache"];
 * ```
 *
 * @since 0.1.0
 */
export type HeaderPair = [header: Header, value: string];

/**
 * A tuple of one or more HeaderPair tuples for batch header operations.
 *
 * This type ensures that at least one header pair is provided when using functions
 * that manipulate multiple headers at once, preventing empty header operations.
 *
 * @example
 * ```ts
 * import { HeaderPairs, HEADER } from "./router.ts";
 *
 * const headers: HeaderPairs = [
 *   [HEADER.ContentType, "application/json"],
 *   [HEADER.CacheControl, "max-age=3600"],
 *   [HEADER.AccessControlAllowOrigin, "*"]
 * ];
 * ```
 *
 * @since 0.1.0
 */
export type HeaderPairs = [HeaderPair, ...HeaderPair[]];

/**
 * Creates a function that sets multiple headers on a Response object.
 *
 * This function uses the Headers.set() method, which replaces any existing values
 * for the specified headers. It's built on top of modify_header for functional composition.
 *
 * @param pairs - One or more header-value pairs to set on the response
 * @returns A function that takes a Response and returns it with the specified headers set
 *
 * @example
 * ```ts
 * import { set_headers, text, HEADER } from "./router.ts";
 *
 * const addApiHeaders = set_headers(
 *   [HEADER.ContentType, "application/json"],
 *   [HEADER.AccessControlAllowOrigin, "*"],
 *   [HEADER.CacheControl, "no-cache"]
 * );
 *
 * const response = addApiHeaders(text("API Response"));
 * ```
 *
 * @since 0.1.0
 */
export function set_headers(
  ...pairs: HeaderPairs
): (res: Response) => Response {
  return modify_header((headers) =>
    pairs.forEach(([header, value]) => headers.set(header, value))
  );
}

/**
 * Creates a function that appends multiple headers to a Response object.
 *
 * This function uses the Headers.append() method, which adds values to existing headers
 * or creates new ones if they don't exist. Useful for headers that can have multiple values.
 *
 * @param pairs - One or more header-value pairs to append to the response
 * @returns A function that takes a Response and returns it with the specified headers appended
 *
 * @example
 * ```ts
 * import { append_header, text, HEADER } from "./router.ts";
 *
 * const addCorsHeaders = append_header(
 *   [HEADER.AccessControlAllowOrigin, "https://example.com"],
 *   [HEADER.AccessControlAllowMethods, "GET, POST"]
 * );
 *
 * const response = addCorsHeaders(text("CORS enabled response"));
 * ```
 *
 * @since 0.1.0
 */
export function append_header(
  ...pairs: HeaderPairs
): (res: Response) => Response {
  return modify_header((headers) =>
    pairs.forEach(([header, value]) => headers.append(header, value))
  );
}

/**
 * Creates a function that deletes multiple headers from a Response object.
 *
 * This function uses the Headers.delete() method to remove the specified headers
 * from a response. Useful for cleaning up unwanted headers before sending responses.
 *
 * @param keys - One or more header names to delete from the response
 * @returns A function that takes a Response and returns it with the specified headers removed
 *
 * @example
 * ```ts
 * import { delete_header, text, HEADER } from "./router.ts";
 *
 * const removeHeaders = delete_header(
 *   HEADER.Server,
 *   HEADER.Date
 * );
 *
 * const response = removeHeaders(text("Clean response"));
 * ```
 *
 * @since 0.1.0
 */
export function delete_header(
  ...keys: [Header, ...Header[]]
): (res: Response) => Response {
  return modify_header((headers) => keys.forEach((key) => headers.delete(key)));
}
type Rec<Key extends string | symbol = string, Value = string> = {
  readonly [K in Key]: Value;
};

/**
 * A comprehensive collection of HTTP methods supported by the router.
 * This constant object provides all standard HTTP methods as defined
 * in RFC specifications, including WebDAV methods and other extensions.
 *
 * @since 0.1.0
 */
export const METHODS = {
  "ACL": "ACL",
  "BIND": "BIND",
  "CHECKOUT": "CHECKOUT",
  "CONNECT": "CONNECT",
  "COPY": "COPY",
  "DELETE": "DELETE",
  "GET": "GET",
  "HEAD": "HEAD",
  "LINK": "LINK",
  "LOCK": "LOCK",
  "MERGE": "MERGE",
  "MKACTIVITY": "MKACTIVITY",
  "MKCALENDAR": "MKCALENDAR",
  "MKCOL": "MKCOL",
  "MOVE": "MOVE",
  "NOTIFY": "NOTIFY",
  "OPTIONS": "OPTIONS",
  "PATCH": "PATCH",
  "POST": "POST",
  "PROPFIND": "PROPFIND",
  "PROPPATCH": "PROPPATCH",
  "PURGE": "PURGE",
  "PUT": "PUT",
  "REBIND": "REBIND",
  "REPORT": "REPORT",
  "SEARCH": "SEARCH",
  "SOURCE": "SOURCE",
  "SUBSCRIBE": "SUBSCRIBE",
  "TRACE": "TRACE",
  "UNBIND": "UNBIND",
  "UNLINK": "UNLINK",
  "UNLOCK": "UNLOCK",
  "UNSUBSCRIBE": "UNSUBSCRIBE",
} as const;

/**
 * A type representing all valid HTTP methods supported by the router.
 * This is a union type of all keys from the METHODS constant, providing
 * type safety when working with HTTP methods in route definitions.
 *
 * @example
 * ```ts
 * import type { Methods } from "./router.ts";
 *
 * // Type-safe method specification
 * const method: Methods = "GET"; // ✓ Valid
 * // const invalidMethod: Methods = "INVALID"; // ✗ TypeScript error
 *
 * // Use in function parameters
 * function handleMethod(method: Methods) {
 *   // method is now type-safe
 *   return method;
 * }
 * ```
 *
 * @since 0.1.0
 */
export type Methods = keyof typeof METHODS;

/**
 * Parses a URL path pattern into a structured type representing the path parameters.
 * This recursive conditional type analyzes path strings with parameter placeholders
 * and wildcards to create a type-safe object structure for accessing matched path segments.
 *
 * The type supports:
 * - Named parameters with `:name` syntax (e.g., `:id`, `:userId`)
 * - Wildcard segments with `*` syntax (captured as array of strings)
 * - Static path segments (ignored in the result type)
 * - HTTP method prefix (ignored in the result type)
 *
 * @since 0.1.0
 */
export type ParsePath<
  P extends string,
  // deno-lint-ignore ban-types
  R extends Record<string, string> = {},
> = P extends `${Methods} /${infer Part}` ? ParsePath<Part>
  : P extends `:${infer Key}/${infer Part}` ? ParsePath<Part, R & Rec<Key>>
  : P extends `*/${infer Part}`
    ? ParsePath<Part, R & Rec<"0", readonly string[]>>
  : P extends `${string}/${infer Part}` ? ParsePath<Part, R>
  : P extends `:${infer Key}` ? ParsePath<"", R & Rec<Key>>
  : P extends `*` ? ParsePath<"", R & Rec<"0", readonly string[]>>
  : { readonly [K in keyof R]: R[K] };

/**
 * A template literal type representing a complete route definition string.
 * This type ensures that route strings follow the correct format of
 * "METHOD /path" where METHOD is one of the supported HTTP methods
 * and path is a valid URL path string.
 *
 * The type provides compile-time validation that route strings are
 * properly formatted and use valid HTTP methods.
 *
 * @example
 * ```ts
 * import type { RouteString } from "./router.ts";
 *
 * // Valid route strings
 * const getUsers: RouteString = "GET /api/users";
 * const postUser: RouteString = "POST /api/users";
 * const wildcardRoute: RouteString = "GET /files/*";
 *
 * // Invalid - would cause TypeScript error
 * // const invalid: RouteString = "GET"; // Missing path
 * // const invalid2: RouteString = "INVALID /path"; // Invalid method
 * ```
 *
 * @since 0.1.0
 */
export type RouteString = `${Methods} /${string}`;

/**
 * Creates a properly typed route string from an HTTP method and path.
 *
 * This utility function combines an HTTP method and path string into a RouteString
 * type, ensuring proper formatting with a space separator. The resulting string
 * follows the "METHOD /path" format expected by the router system.
 *
 * @param method - The HTTP method to use in the route string
 * @param path - The URL path pattern for the route
 * @returns A properly formatted route string with type safety
 *
 * @example
 * ```ts
 * import { route_string } from "./router.ts";
 *
 * const userRoute = route_string("GET", "/users/:id");
 * const postRoute = route_string("POST", "/users");
 * const wildcardRoute = route_string("GET", "/files/*");
 * ```
 *
 * @since 0.1.0
 */
export function route_string(method: Methods, path: string): RouteString {
  return `${method} /${path}` as RouteString;
}

/**
 * A function type for logging messages at various levels.
 *
 * LogFn represents a variadic function that accepts any number of arguments
 * of any type and returns void. This type is used for all logging functions
 * in the Logger interface, providing flexibility for different logging implementations.
 *
 * @example
 * ```ts
 * import type { LogFn } from "./router.ts";
 *
 * const simpleLogger: LogFn = (message: string, ...args: any[]) => {
 *   console.log(`[${new Date().toISOString()}] ${message}`, ...args);
 * };
 *
 * const structuredLogger: LogFn = (...data: any[]) => {
 *   const entry = {
 *     timestamp: new Date().toISOString(),
 *     level: "info",
 *     data: data
 *   };
 *   console.log(JSON.stringify(entry));
 * };
 * ```
 *
 * @since 0.1.0
 */
// deno-lint-ignore no-explicit-any
export type LogFn = (...data: any[]) => void;

/**
 * An interface defining a complete logging system with multiple severity levels.
 *
 * The Logger interface provides methods for logging at different levels of severity,
 * from most critical (fatal) to least critical (trace). Each logging method accepts
 * a LogFn function that can handle variadic arguments for flexible logging formats.
 *
 * This interface allows for easy mocking in tests and custom logging implementations
 * while maintaining consistent logging behavior across the router system.
 *
 * @example
 * ```ts
 * import type { Logger } from "./router.ts";
 * import type { LogFn } from "./router.ts";
 *
 * const customLogger: Logger = {
 *   fatal: (message: string, error?: Error) => {
 *     console.error(`FATAL: ${message}`, error);
 *     // Send to external logging service
 *   },
 *   error: (message: string, ...args: any[]) => {
 *     console.error(`ERROR: ${message}`, ...args);
 *   },
 *   warn: (message: string, ...args: any[]) => {
 *     console.warn(`WARN: ${message}`, ...args);
 *   },
 *   info: (message: string, ...args: any[]) => {
 *     console.info(`INFO: ${message}`, ...args);
 *   },
 *   debug: (message: string, ...args: any[]) => {
 *     console.debug(`DEBUG: ${message}`, ...args);
 *   },
 *   trace: (message: string, ...args: any[]) => {
 *     console.trace(`TRACE: ${message}`, ...args);
 *   }
 * };
 * ```
 *
 * @since 0.1.0
 */
export type Logger = {
  readonly fatal: LogFn;
  readonly error: LogFn;
  readonly warn: LogFn;
  readonly info: LogFn;
  readonly debug: LogFn;
  readonly trace: LogFn;
};

/**
 * A default logger implementation that uses the browser/Deno console methods.
 *
 * This logger provides a standard implementation of the Logger interface using
 * the global console object's methods for each logging level. It serves as a
 * sensible default that can be overridden when creating contexts or routers
 * that require custom logging behavior.
 *
 * All logging methods in this implementation map directly to their corresponding
 * console methods with the same names.
 *
 * @example
 * ```ts
 * import { DEFAULT_LOGGER, context } from "./router.ts";
 *
 * // Use the default logger when creating contexts
 * const ctx = context({ userId: "123" }, DEFAULT_LOGGER);
 *
 * ctx.logger.info("User logged in:", ctx.state.userId);
 * ctx.logger.error("Database connection failed");
 * ctx.logger.debug("Processing request", { method: "GET", path: "/api/users" });
 * ```
 *
 * @since 0.1.0
 */
export const DEFAULT_LOGGER: Logger = {
  fatal: console.error,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  trace: console.trace,
};

function noop(): void {}

export const NOOP_LOGGER: Logger = {
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
};

/**
 * The context object passed to route handlers, containing all the information
 * needed to process a request. The context provides access to the original
 * request, URL pattern matching results, and any shared state data.
 *
 * @since 0.1.0
 */
export type Ctx<D = unknown> = {
  readonly logger: Logger;
  readonly state: D;
};

/**
 * Creates a context object for route handlers. The context encapsulates all
 * the information needed to process a request, including the original request,
 * URL pattern matching results, and shared state data.
 *
 * This function is typically used internally by the router when invoking
 * route handlers, but can also be used directly when testing handlers or
 * building custom routing logic.
 *
 * @param request The original HTTP request object.
 * @param pattern_result The result of URL pattern matching, containing extracted path parameters.
 * @param state The shared state data passed between routes.
 * @returns A context object that can be passed to route handlers.
 *
 * @since 0.1.0
 */
export function context<D = unknown>(
  state: D,
  logger: Logger = DEFAULT_LOGGER,
): Ctx<D> {
  return { state, logger };
}

/**
 * A type alias for the Effect used as route handlers in the router system.
 * Route handlers are Effect functions that take a context containing the request,
 * URL pattern matching results, and shared state, and return a Response wrapped
 * in the Effect's error handling system.
 *
 * The Effect signature is:
 * - Input state: [Ctx<D>] (context with shared state of type D)
 * - Error type: Response (failed responses become error values)
 * - Success type: Response (successful responses become success values)
 * - Output state: unknown[] (handler can modify shared state)
 *
 * @since 0.1.0
 */
export type Handler<D = unknown> = Effect<
  [Request, URLPatternResult, Ctx<D>],
  Response,
  Response
>;

/**
 * Represents a complete route definition in the router system. A route
 * consists of an HTTP method, URL pattern, compiled URLPattern for matching,
 * and a handler function that processes matching requests.
 *
 * Routes are the core building blocks of the router, defining how different
 * URL patterns and HTTP methods are handled. Each route can access shared
 * state and provides type-safe parameter extraction from URLs.
 *
 * @since 0.1.0
 */
export type Route<D = unknown> = {
  readonly method: Methods;
  readonly pathname: string;
  readonly url_pattern: URLPattern;
  readonly handler: Handler<D>;
  // Here we will add input and output schemas at a later date.
};

/**
 * A type alias for routes with untyped or unknown state. This is useful when
 * working with collections of routes where the specific state type is not
 * known or when building generic routing utilities that work with any route type.
 *
 * This type should be used sparingly in application code, as it loses the
 * type safety benefits of the generic Route<D> type. It's primarily intended
 * for library and utility functions that need to work with arbitrary routes.
 *
 * @since 0.1.0
 */
// deno-lint-ignore no-explicit-any
export type AnyRoute = Route<any>;

/**
 * Creates a route definition from a route string and handler function.
 * This is the low-level function for creating routes, handling the parsing
 * of the route string into method and pathname components, and creating
 * the URLPattern for request matching.
 *
 * For most use cases, the `right()` helper function is preferred as it
 * provides better type safety and ergonomics for route definitions.
 *
 * @template D The type of shared state passed between routes.
 * @param route_string A string in the format "METHOD /pathname" (e.g., "GET /users/:id").
 * @param handler The route handler function that processes matching requests.
 * @returns A complete route definition ready to be used in a router.
 *
 * @example
 * ```ts
 * import { route, router, right, context } from "./router.ts";
 * import { right as rightEither, left as leftEither } from "@baetheus/fun/either";
 * import { todo } from "@baetheus/fun/fn";
 * import * as E from "@baetheus/fun/effect";
 *
 * type User = {
 *   id: string;
 *   name: string;
 *   email: string;
 * }
 *
 * type Database = {
 *   findUser: (id: string) => Promise<User>;
 * }
 *
 * // Create a route manually using the low-level API
 * const userRoute = route<{ db: Database }>(
 *   "GET /users/:id",
 *   async (request, patternResult, ctx) => {
 *     const userId = patternResult.pathname.groups.id;
 *     if (!userId) {
 *       return [leftEither(new Response("User ID is required", { status: 400 })), ctx.state];
 *     }
 *     const user = await ctx.state.db.findUser(userId);
 *     return [rightEither(new Response(JSON.stringify(user))), ctx.state];
 *   }
 * );
 *
 * // Use in a router
 * const ctx = context({ db: { findUser: todo } });
 * const appRouter = router(ctx, { routes: [userRoute] });
 *
 * // Alternative: use the right() helper for better ergonomics
 * const betterRoute = right("GET /users/:id", (request, params) => {
 *   return new Response(`User ${params.id}`);
 * });
 * ```
 *
 * @since 0.1.0
 */
export function route<D>(
  method: Methods,
  path: string,
  handler: Handler<D>,
): Route<D> {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  return {
    method,
    pathname,
    handler,
    url_pattern: new URLPattern({ pathname }),
  };
}

/**
 * Creates a route with a handler that expects to return successful responses.
 * This helper function provides better ergonomics than the low-level `route()`
 * function by automatically handling path parameter extraction and Effect wrapping.
 *
 * The handler function receives both the context and parsed path parameters,
 * and should return a Response directly (not wrapped in an Effect). The function
 * automatically wraps the handler in the Effect system and handles path parsing.
 *
 * Use this function for the majority of route definitions as it provides the
 * best balance of type safety and ergonomics.
 *
 * @template D The type of shared state passed between routes.
 * @template R The route string type that determines the structure of path parameters.
 * @param route_string A string in the format "METHOD /pathname" with parameter placeholders.
 * @param handler A function that receives context and parsed path parameters, returns a Response.
 * @returns A complete route definition ready to be used in a router.
 *
 * @example
 * ```ts
 * import { right } from "./router.ts";
 *
 * // Simple route without parameters
 * const homeRoute = right("GET /", (ctx) => {
 *   return new Response("Welcome home!");
 * });
 *
 * // Route with path parameters
 * const userRoute = right("GET /users/:id", (_, params) => {
 *   const userId = params.id; // Type-safe access to path parameter
 *   return new Response(`User ID: ${userId}`);
 * });
 *
 * // Route with multiple parameters
 * const blogRoute = right("GET /:year/:month/:slug", (_, params) => {
 *   const { year, month, slug } = params;
 *   return new Response(`Blog post: ${year}/${month}/${slug}`);
 * });
 *
 * // Route with wildcard
 * const fileRoute = right("GET /files/:path/*", (_, params) => {
 *   const { path, 0: segments } = params;
 *   return new Response(`File: ${path}, segments: ${segments.join('/')}`);
 * });
 * ```
 *
 * @since 0.1.0
 */
export function right<D, R extends RouteString>(
  route_string: R,
  handler: (
    request: Request,
    path: ParsePath<R>,
    ctx: Ctx<D>,
  ) => Response | Promise<Response>,
): Route<D> {
  const [method, path_name] = route_string.split(" ") as [Methods, string];
  return route(
    method,
    path_name,
    E.gets(handler) as unknown as Handler<D>,
  );
}

/**
 * Creates a route with a handler that expects to return error responses.
 * This helper function is similar to `right()` but wraps the handler's return
 * value as an error (Left) in the Effect system instead of a success (Right).
 *
 * This is useful for routes that are designed to handle error conditions
 * or when you want to explicitly handle failures in your routing logic.
 * The handler function still receives the same context and path parameters,
 * but the returned Response will be treated as an error response.
 *
 * @template D The type of shared state passed between routes.
 * @template R The route string type that determines the structure of path parameters.
 * @param route_string A string in the format "METHOD /pathname" with parameter placeholders.
 * @param handler A function that receives context and parsed path parameters, returns a Response.
 * @returns A complete route definition ready to be used in a router.
 *
 * @example
 * ```ts
 * import { left } from "./router.ts";
 *
 * // Route that always returns error responses
 * const errorRoute = left("GET /error", () => {
 *   return new Response("Something went wrong", { status: 500 });
 * });
 *
 * // Conditional error handling
 * const conditionalErrorRoute = left("GET /admin/:action", (request, params) => {
 *   const user = request.headers.get("authorization");
 *   if (!user) {
 *     return new Response("Unauthorized", { status: 403 });
 *   }
 *   return new Response("Forbidden", { status: 403 });
 * });
 * ```
 *
 * @since 0.1.0
 */
export function left<D, R extends RouteString = RouteString>(
  route_string: R,
  handler: (
    request: Request,
    path: ParsePath<R>,
    ctx: Ctx<D>,
  ) => Response | Promise<Response>,
): Route<D> {
  const [method, path_name] = route_string.split(" ") as [Methods, string];
  return route(
    method,
    path_name,
    E.getsSecond(handler) as unknown as Handler<D>,
  );
}

/**
 * A function type that transforms route handlers to add cross-cutting concerns.
 *
 * Middleware functions wrap route handlers to provide functionality that should
 * be applied to multiple routes, such as authentication, logging, error handling,
 * request/response transformation, and other aspects that are orthogonal to the
 * core route logic.
 *
 * Middleware functions receive the original handler and return a new handler with
 * the additional behavior. They have access to the same context and can modify
 * requests, responses, or handle errors as needed.
 *
 * @template D The type of shared state passed between routes and middleware.
 *
 * @example
 * ```ts
 * import type { Middleware } from "./router.ts";
 * import { left as leftEither } from "@baetheus/fun/either";
 *
 * // Authentication middleware
 * const authMiddleware: Middleware<{ user?: string }> = (handler) => {
 *   return async (request, patternResult, ctx) => {
 *     const authHeader = request.headers.get("authorization");
 *     if (!authHeader) {
 *       return [leftEither(new Response("Unauthorized", { status: 401 })), ctx.state];
 *     }
 *
 *     // Validate and pass through to handler
 *     return handler(request, patternResult, ctx);
 *   };
 * };
 *
 * // Logging middleware
 * const loggingMiddleware: Middleware<unknown> = (handler) => {
 *   return async (request, patternResult, ctx) => {
 *     const start = Date.now();
 *     ctx.logger.info(`Request: ${request.method} ${request.url}`);
 *
 *     const result = await handler(request, patternResult, ctx);
 *     const duration = Date.now() - start;
 *     ctx.logger.info(`Response in ${duration}ms`);
 *     return result;
 *   };
 * };
 * ```
 *
 * @since 0.1.0
 */
export type Middleware<D> = (route: Handler<D>) => Handler<D>;

/**
 * A utility function for creating middleware with explicit type annotations.
 *
 * This function serves as an identity function for middleware, primarily useful
 * for providing better type inference and explicit type annotations when working
 * with middleware functions. It ensures that the middleware function conforms to
 * the Middleware<D> type while providing no runtime behavior.
 *
 * In most cases, you can pass middleware functions directly without using this
 * utility, but it can be helpful when you need to be explicit about types or
 * when working with complex generic middleware scenarios.
 *
 * @template D The type of shared state passed between routes and middleware.
 * @param m The middleware function to wrap with explicit typing.
 * @returns The same middleware function with explicit type annotations.
 *
 * @example
 * ```ts
 * import { middleware } from "./router.ts";
 * import type { Middleware, Handler } from "./router.ts";
 *
 * // Using the utility for explicit typing
 * const typedMiddleware = middleware<{ user?: string }>((handler) => {
 *   return async (request, patternResult, ctx) => {
 *     // Middleware implementation
 *     return handler(request, patternResult, ctx);
 *   };
 * });
 *
 * // Direct usage (more common)
 * const directMiddleware: Middleware<{ user?: string }> = (handler) => {
 *   return async (request, patternResult, ctx) => {
 *     // Middleware implementation
 *     return handler(request, patternResult, ctx);
 *   };
 * };
 * ```
 *
 * @since 0.1.0
 */
export function middleware<D>(m: Middleware<D>): Middleware<D> {
  return m;
}

/**
 * The main router interface that manages route registration and request handling.
 * A router maintains a collection of routes and provides methods to add new routes
 * and handle incoming HTTP requests by matching them against registered routes.
 *
 * The router supports method and URL pattern matching, automatic path parameter
 * extraction, and shared state management across all routes.
 *
 * @template S The type of shared state passed to all route handlers.
 *
 * @since 0.1.0
 */
export type Router = {
  handle(request: Request): Response | Promise<Response>;
  // Additional tools here like to_tree and such
};

const extract_response = match(identity<Response>, identity<Response>);

function create_route_map<D>(): { [K in Methods]: Route<D>[] } {
  return pipe(
    METHODS,
    mapRecord(() => [] as Route<D>[]),
  ) as { [K in Methods]: Route<D>[] };
}

export type RouterConfig<D> = {
  readonly routes: Route<D>[];
  readonly middlewares: Middleware<D>[];
  readonly default_handler: (req: Request) => Response | Promise<Response>;
};

/**
 * Creates a new router instance with the specified shared state and initial routes.
 * The router is the central component for handling HTTP requests, matching them
 * against registered routes, and invoking the appropriate handlers.
 *
 * The router supports:
 * - HTTP method and URL pattern matching
 * - Path parameter extraction with type safety
 * - Shared state management across all routes
 * - Dynamic route registration via add_routes()
 * - Custom 404 handling via default_handler
 *
 * @template S The type of shared state passed to all route handlers.
 * @param state The shared state object accessible to all route handlers.
 * @param routes Initial array of routes to register with the router.
 * @param default_handler Optional handler for requests that don't match any routes.
 * @returns A fully configured router instance ready to handle requests.
 *
 * @example
 * ```ts
 * import { router, right, context, STATUS_CODE, text } from "./router.ts";
 * import { todo } from "@baetheus/fun/fn";
 *
 * type User = {
 *   id: string;
 *   name: string;
 *   email: string;
 * }
 *
 * type Database = {
 *   findUser: (id: string) => Promise<User>;
 *   createUser: (user: User) => Promise<User>;
 * }
 *
 * type State = {
 *   db: Database;
 *   cache: Map<string, unknown>;
 * }
 *
 * const appState: State = {
 *   db: { findUser: todo, createUser: todo },
 *   cache: new Map(),
 * };
 *
 * // Create context
 * const ctx = context(appState);
 *
 * // Create router with initial routes
 * const appRouter = router(ctx, {
 *   routes: [
 *     right("GET /", (request, params, ctx) => {
 *       ctx.logger.info("Home page accessed");
 *       return new Response("Welcome to our API!");
 *     }),
 *
 *     right("GET /users/:id", async (request, params, ctx) => {
 *       const user = await ctx.state.db.findUser(params.id);
 *       return new Response(JSON.stringify(user));
 *     }),
 *
 *     right("POST /users", async (request, params, ctx) => {
 *       const userData = await request.json();
 *       const newUser = await ctx.state.db.createUser(userData as User);
 *       return new Response(JSON.stringify(newUser), {
 *         status: 201,
 *         headers: { "Content-Type": "application/json" }
 *       });
 *     }),
 *
 *     right("GET /health", () => new Response("OK")),
 *
 *     right("GET /metrics", (request, params, ctx) => {
 *       const metrics = ctx.state.cache.get("metrics");
 *       return new Response(JSON.stringify(metrics));
 *     })
 *   ]
 * });
 *
 * // Custom 404 handler
 * const custom404Handler = (req: Request) => {
 *   return text(`Route ${req.method} ${new URL(req.url).pathname} not found`, STATUS_CODE.NotFound);
 * };
 *
 * const routerWithCustom404 = router(ctx, {
 *   routes: [],
 *   default_handler: custom404Handler
 * });
 * ```
 *
 * @since 0.1.0
 */
export function router<D>(
  ctx: Ctx<D>,
  {
    routes = [],
    middlewares = [],
    default_handler = () => text("Not Found", STATUS_CODE.NotFound),
  }: Partial<RouterConfig<D>>,
): Router {
  // Sort routes by method to avoid needles URLPattern.exec
  const route_map = create_route_map<D>();

  // Wrap all routes in middleware
  const wrap_handler = (h: Handler<D>, m: Middleware<D>): Handler<D> => m(h);
  const wrap_route = (
    { method, pathname, url_pattern, handler }: Route<D>,
  ): Route<D> => {
    const new_handler = middlewares.reduce(wrap_handler, handler);
    return { method, pathname, url_pattern, handler: new_handler };
  };
  const default_route = wrap_route(
    route("GET", "/*", E.gets(default_handler)),
  );

  for (const route of routes) {
    const wrapped_route = wrap_route(route);
    route_map[wrapped_route.method].push(wrapped_route);
  }

  // Return the Router
  return {
    async handle(request) {
      try {
        // The fallback here isn't necessary but is extra extra safe.
        const routes = route_map[request.method.toUpperCase() as Methods] ?? [];

        // Use the first route we find that exec's correctly
        for (const route of routes) {
          const pattern_result = route.url_pattern.exec(request.url);
          if (pattern_result !== null) {
            const [result] = await route.handler(
              request,
              pattern_result,
              ctx,
            );
            return extract_response(result);
          }
        }

        // Otherwise use the default handler
        const [result] = await default_route.handler(
          request,
          {} as URLPatternResult,
          ctx,
        );
        return extract_response(result);
      } catch (e) {
        ctx.logger.fatal(e);
        return text("Internal Server Error", STATUS_CODE.InternalServerError);
      }
    },
  };
}
