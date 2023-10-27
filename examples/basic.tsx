/** @jsx h */

import type { Context } from "../context.ts";

import * as N from "fun/nil.ts";
import * as P from "fun/promise.ts";
import { h } from "https://esm.sh/preact@10.18.1";
import { pipe } from "fun/fn.ts";

import { handle, respond, router, use } from "../router.ts";
import { cacheUrl } from "../cache.ts";
import { puts } from "../handler.ts";
import * as R from "../response.ts";

type Deps = {
  count: number;
  defaultURL: URL;
};

// A Route that renders some jsx
function countRoute(ctx: Context<Deps, unknown>): Response {
  const count = ctx.state.count++;
  return R.jsx(<h1>Count is {count}</h1>);
}

// Some constants for the proxy route
const defaultURL = new URL("https://bee.ignoble.dev");
const safeURL = N.tryCatch((url: string) => new URL(url));
const safeFetch = P.tryCatch(fetch, (err, [url]) =>
  R.jsx(
    <main>
      <h1>An Error occurred while fetching {url}</h1>
      <pre>{String(err)}</pre>
    </main>,
  ));

const handler = pipe(
  router<Deps>(),
  // Respond by rendering jsx with preact render-to-string. This route uses and
  // modifies the state variable directly. This is normally discouraged but
  // illustrates what is likely to become a common simple use case.
  //
  // Ideally, state would be an object containing readonly methods for state CRUD
  // operations.
  respond("GET /count", countRoute),
  // Here we use a handler directly in order to get access to the cacheUrl
  // function. This function will only run the countRoute function on the unique
  // url that it sees. Since we have isolated this handler to `GET /static` it's
  // likely that it will only be run once.
  handle("GET /static", cacheUrl(puts(countRoute))),
  // This is an example of how to proxy to a fetch response. Since Deno uses web
  // standard Request and Response types this becomes some trivial parsing
  respond("GET /proxy", ({ request, state }) =>
    pipe(
      safeURL(request.url),
      N.flatmap((url) => url.searchParams.get("search")),
      N.flatmap(safeURL),
      N.getOrElse(() => state.defaultURL),
      safeFetch,
    )),
  // This is an example of parsing values out of the path
  respond(
    "GET /person/:first/:last/:age/:children/",
    ({ variables: { first, last, age } }) => {
      console.log({ first, last, age });
      return R.jsx(<h1>Hi {first} {last}, {age}!</h1>);
    },
  ),
  use({ count: 0, defaultURL }),
);

Deno.serve(handler);
