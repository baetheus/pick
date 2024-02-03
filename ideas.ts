/**
 * Here are some ideas for router and route. Handler is already set as an async
 * indexed state monad.
 *
 * ```ts
 * export type Handler<D, A, B> = (d: D) => Promise<[A, B]>;
 * ```
 */

import type { Option } from "fun/option";
import type { Schema } from "fun/schemable";

import type { PathVars, RouteParser, RouteString } from "./parser.ts";
import type { Handler } from "./handler.ts";

import * as S from "fun/schemable";

/**
 * Content is used to create parsers and definitions for requests or responses.
 * All
 */
export interface Content<I> {
  schema: Schema<I>;
}

/**
 * Context is all of the things that are parsed out of the request
 */
export interface Context<S, P, I = never> {
  request: Request;
  state: S;
  variables: P;
  input: I;
}

declare const req: Request;
const a = req.blob;

/**
 * A full route defines:
 *
 * * Path: A unique RouteString of the format `VERB /path/:with/vars/*`
 * * Input: An extension like fun/schemable.ts#Schema that defines content-type
 *   and data shape. This `Schema` must be able to output json_schema and a
 *   decoder for the request body.
 * * Output: Like input, this is a `Schema`-like that defines content-type and
 *   data shape. This is used to construct json_schema for openapi generation as
 *   well as typing the handler output.
 * * Parser: A parser takes in the Path RouteString and returns a filterMap
 *   function that either parses the path in Request to `Some<PathVars<P>>` or
 *   `None` if the route doesn't match.
 * * Handler: A handler is where the route work is done after path and body
 *   parsing are complete.
 *
 * The goal here is to have the kitchen sink of options for defining a route,
 * but in actual use I expect to create a handful of combinators over route that
 * simplify its use.
 */
export interface Route<S, P extends RouteString, I, O> {
  readonly path: P; // The RouteString is unique for each route
  readonly input: Schema<I>; // Probably use a more restricted schema here
  readonly output: Schema<O>; // Probably use a more restricted schema here
  readonly parser: RouteParser<PathVars<P>>; // Parser only types the path params
  readonly handler: Handler<Context<S, PathVars<P>, I>, O, unknown>;
}

export function route<S, P extends RouteString, I, O>(
  r: Route<S, P, I, O>,
): Route<S, P, I, O> {
  return r;
}

/**
 * Routes is a dictionary of Route values keyed by their path.
 */
// deno-lint-ignore no-explicit-any
export type Routes<S> = { [K: RouteString]: Route<S, RouteString, any, any> };

/**
 * A RouterContext is used by the router when finding the route to use for a
 * request.
 */
export interface RouterContext<S, I> {
  readonly request: Request;
  readonly state: S;
  readonly info: I;
}

/**
 * An abstract router implementation needs to:
 *
 * * Add routes and keep track at the type level of the routes that have been
 *   added to avoid conflicts.
 * * Remove routes and keep track of it at the type level.
 * * Find a route that matches a given RouterContext.
 *
 * This allows us to try out different router implementations depending on the
 * application. For applications that require extremely fast route mapping we
 * can implement a red/black tree. For applications that prefer a fallthrough
 * design where many route definitions overlap and a specific order is needed we
 * can implement an array.
 */
export interface Router<S, R extends Routes<S> = {}> {
  readonly find: <P extends RouteString, I, O>(
    ctx: RouterContext<S, Deno.ServeHandlerInfo>,
  ) => Option<Route<S, P, I, O>>;
  readonly addRoute: <P extends RouteString, I, O>(
    route: Route<S, Exclude<P, keyof R>, I, O>,
  ) => Router<
    S,
    { [K in (keyof R) | P]: K extends keyof R ? R[K] : typeof route }
  >;
  readonly removeRoute: <P extends RouteString>(
    path: P,
  ) => Router<S, { [K in Exclude<P, keyof R>]: R[K] }>;
}
