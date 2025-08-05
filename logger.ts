import type { Router } from "./router.ts";
import type { Context } from "./context.ts";
import type { Route } from "./route.ts";
import type { Handler } from "./handler.ts";

import { pipe } from "fun/fn";
import { map } from "fun/array";

import { route } from "./route.ts";

export type LogRequest = {
  readonly id: string;
  readonly startTime: number;
  readonly context: Context;
};

export type LogResponse = {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly deltaTime: number;
  readonly response: Response;
  readonly context: Context;
  readonly output: unknown;
};

function nanoid(
  size = 12,
  dictionary = "useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict",
) {
  let id = "";
  const random = crypto.getRandomValues(new Uint8Array(size));
  for (let n = 0; n < size; n++) {
    id += dictionary[61 & random[n]];
  }
  return id;
}

export function defaultRequestLogger(
  { id, startTime, context: { request: { url, method } } }: LogRequest,
): void {
  console.log(`[${startTime}][${id}] ${method} ${url}`);
}

export function defaultResponseLogger(
  { id, endTime, deltaTime, response: { status } }: LogResponse,
): void {
  console.log(`[${endTime}][${id}] ${status} in ${deltaTime}ms`);
}

export function createLogHandler(
  onRequest: (req: LogRequest) => void = defaultRequestLogger,
  onResponse: (res: LogResponse) => void = defaultResponseLogger,
): <S, V, O>(
  handler: Handler<Context<S, V>, Response, O>,
) => Handler<Context<S, V>, Response, O> {
  return (handler) => async (context) => {
    const id = nanoid();
    const startTime = Date.now();
    onRequest({ id, startTime, context });

    const result = await handler(context);

    const endTime = Date.now();
    const deltaTime = endTime - startTime;
    const [response, output] = result;
    onResponse({
      id,
      startTime,
      endTime,
      deltaTime,
      response,
      context,
      output,
    });
    return result;
  };
}

export function createLogRoute(
  onRequest: (req: LogRequest) => void = defaultRequestLogger,
  onResponse: (res: LogResponse) => void = defaultResponseLogger,
): <S, V>(r: Route<V, S>) => Route<V, S> {
  const logHandler = createLogHandler(onRequest, onResponse);
  return (r) => route(r.route, r.parser, logHandler(r.handler));
}

export function createLogRouter(
  onRequest: (req: LogRequest) => void = defaultRequestLogger,
  onResponse: (res: LogResponse) => void = defaultResponseLogger,
): <S>(router: Router<S>) => Router<S> {
  const logRoute = createLogRoute(onRequest, onResponse);
  return (router) => pipe(router, map(logRoute));
}
