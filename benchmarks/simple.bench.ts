import * as Router from "../router.ts";

const hello_route = Router.right(
  "GET /",
  () => Router.text(`Hello World`),
);

const simple_router = Router.router(Router.context(null), {
  routes: [hello_route],
});

const simple = Deno.serve({ port: 10_000 }, simple_router.handle);
const minimal = Deno.serve({ port: 10_001 }, () => new Response("Hello World"));

const simple_url = new URL(
  `http://${simple.addr.hostname}:${simple.addr.port}`,
);
const minimal_url = new URL(
  `http://${minimal.addr.hostname}:${minimal.addr.port}`,
);

Deno.bench("minimal deno server", { group: "simple" }, async () => {
  await fetch(minimal_url);
});

Deno.bench("simple deno server", { group: "simple" }, async () => {
  await fetch(simple_url);
});
