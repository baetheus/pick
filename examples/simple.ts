/**
 * This examply shows a simple use of Router with the `right` combinator to
 * build a simple text route that has access to path params and mutable state.
 */
import * as R from "../router.ts";

type State = { count: number };

const hello_route = R.right(
  "GET /hello/:name",
  (_, { name }, ctx: R.Ctx<State>) =>
    R.text(`Hello ${name} number ${++ctx.state.count}!`),
);

const router = R.router<State>(R.context({ count: 0 }), {
  routes: [hello_route],
});

Deno.serve(router.handle);
