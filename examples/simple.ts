import * as R from "../router.ts";
import { html } from "../response.ts";
import { pipe } from "fun/fn.ts";

const handler = pipe(
  R.router(),
  R.respond(
    "GET /hello/:name",
    (ctx) => html(`<h1>Hello ${ctx.variables.name}</h1>`),
  ),
  R.use(null),
);

Deno.serve(handler);
