/**
 * The current view of this file is very simplistic. Ideally, building up a
 * Response with pipeable combinators is the goal.
 */

import type { VNode } from "https://esm.sh/preact@10.18.1";

import { contentType } from "https://deno.land/std@0.204.0/media_types/content_type.ts";
import { render } from "https://esm.sh/preact-render-to-string@6.2.2";
import * as E from "fun/either.ts";
import { pipe } from "fun/fn.ts";

export function html(html: string): Response {
  return new Response(html, {
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
