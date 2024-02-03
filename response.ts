/**
 * The current view of this file is very simplistic. Ideally, building up a
 * Response with pipeable combinators is the goal.
 */

import type { VNode } from "preact";

import { contentType } from "@std/media-types";
import { render } from "preact-render-to-string";
import * as E from "fun/either";
import { pipe } from "fun/fn";

export function html(html: string): Response {
  return new Response(`<!DOCTYPE html>${html}`, {
    headers: { "content-type": contentType("html") },
  });
}

export function jsx(vnode: VNode): Response {
  return html(render(vnode));
}

export function error(message: string, status = 500): Response {
  return new Response(message, { status });
}

const stringify = E.tryCatch(JSON.stringify, (err) => {
  const error = new Error("Unable to stringify value as JSON");
  error.cause = err;
  return error;
});

export function json<O>(value: O): Response {
  return pipe(
    value,
    stringify,
    E.match(
      (err) => {
        console.error(err);
        return error(err.toString());
      },
      (value) =>
        new Response(value, {
          headers: { "content-type": contentType("json") },
        }),
    ),
  );
}
