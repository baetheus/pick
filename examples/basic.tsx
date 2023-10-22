/** @jsx h */

import { pipe } from "fun/fn.ts";
import { h } from "https://esm.sh/preact@10.18.1";

import { handle, router, use } from "../router.ts";
import * as R from "../response.ts";
import * as H from "../handler.ts";

type Deps = { count: number };

function Count({ count }: Deps) {
  return <h1>Count is {count}</h1>;
}

const handler = pipe(
  router<Deps>(),
  handle(
    "GET /count",
    ({ state }) => {
      state.count++;
      return R.jsx(Count(state));
    },
  ),
  handle(
    "GET /static",
    H.alwaysCache(() => R.jsx(Count({ count: 0 }))),
  ),
  handle("POST /proxy", async ({ request }) => {
    const body = await request.text().catch(() => "https://bee.ignoble.dev");
    return fetch(body);
  }),
  use({ count: 0 }),
);

Deno.serve(handler);
