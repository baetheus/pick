import * as R from "../router.ts";
import { html } from "../response.ts";
import { pipe } from "fun/fn.ts";

const handler = pipe(
  R.router<{ count: number }>(),
  R.respond(
    "GET /hello/:name",
    (ctx) =>
      html(
        `<h1>Hello ${ctx.path.name}, you are number ${++ctx.state.count}</h1>`,
      ),
  ),
  R.withState({ count: 0 }),
);

Deno.serve(handler);
