/** @jsx h */

import { pipe } from "fun/fn.ts";
import { h } from "https://esm.sh/preact@10.18.1";

import { respond, router, use } from "../router.ts";
import { cacheUrl } from "../cache.ts";
import * as R from "../response.ts";

type Deps = { count: number };

function Count({ count }: Deps) {
  return <h1>Count is {count}</h1>;
}

const respondr = pipe(
  router<Deps>(),
  respond(
    "GET /count",
    ({ state }) => {
      state.count++;
      return R.jsx(Count(state));
    },
  ),
  respond(
    "GET /static",
    cacheUrl(({ state: { count } }) => R.jsx(Count({ count }))),
  ),
  respond("POST /proxy", async ({ request }) => {
    const body = await request.text().catch(() => "https://bee.ignoble.dev");
    return fetch(body);
  }),
  use({ count: 0 }),
);

Deno.serve(respondr);

cacheUrl;
