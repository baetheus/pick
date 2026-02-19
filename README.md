# pick - no magic router for [Deno](https://deno.land) http servers

[![JSR](https://jsr.io/badges/@baetheus/pick)](https://jsr.io/@baetheus/pick)

Deno gives us a powerful, fast, web standards compliant http server with a
simple and extensible new interface. However, most router modules are still
implementing the patterns pioneered in nodejs. Specifically, we see
reimplementations of untyped middleware (express) with its bug ridden `next`
pattern.

Additionally, beyond the middleware based routers, we have next, remix, and
fresh creating automagical frameworks that are often template heavy and
complicated just to satisfy the constantly moving goalpost of developer
experience.

This module seeks to explore a different paradigm. Namely, pick is focused on
the following:

1. Doesn't require any templating tools or automagical project setup.
2. Builds directly on the Deno.ServeHandler, which itself builds on web
   standards.
3. Uses typescript types and request parsing to provide rich types to handlers.
4. Composes well enough to implement an SSR framework like fresh as well as an
   autodocumenting API framework like Oxide Computer Company's dropshot.

Things that I am willing to give up from existing frameworks:

1. Middleware
2. Filesystem based routing
3. A CLI tool for managing the module
4. The minimal case being a single line server (just use Deno.serve!)

If all goes well this project will be rolling out features in stages. Here are
the planned features in no particular order.

- method and path parsing at the type level
- response combinators for rendering jsx, markdown, html, json, etc
- body decoding combinators for forms, json, etc
- response streaming for media
- tools for static site rendering, specifically get/post combinations
- tools for automatic api documentation (openapi)
- caching combinators based on request, backend, variables, state, etc
- route and handler generators

## Design Ideas

There are two driving ideas in this library. The first is that we can derive
rich type information from a simple string route definition like "GET /:home"
and use it to route and parse.

The second is to build a route Handler as an indexed, asynchronous state monad.
That's some fancy words for the following type:

```ts
type Handler<S, A, O> = (s: S) => Promise<[A, O]>;
```

Handler is super generic and doesn't really illuminate our design. More
generally, the router in pick expects the more specific Handler that looks like:

```ts
// Context
// S is the application state
type Context<S> = {
  readonly state: S;
};

// A route handler receives the request, parsed path parameters, and context
type RouteHandler<S, V> = (
  request: Request,
  path: V,
  ctx: Context<S>,
) => Response | Promise<Response>;
```

The Router in pick doesn't really care about the output state `O` of the Handler
but we keep it around in case the user wants to compose Handlers by modifying
state, thus recovering a well typed form of middleware without using `next`.

Lastly, we come to the default type that most users of this library will use. I
call it a `Responder`, but it is really the non-indexed part of `Handler`

```ts
type Responder<D, A> = (d: D) => A | Promise<A>;
```

`Handler` is a effectively a super type of `Responder`. This gets at the root
design idea of pick. Start with a sufficiently powerful type for route handling
that can be trivial "simplified" to a very useful minimal implementation.

Put this all together and a simple router can be set up like so:

```ts
import { context, html, right, router } from "@baetheus/pick/router";

const ctx = context({ count: 0 });

const myRouter = router(ctx, {
  routes: [
    right("GET /hello/:name", (request, params, ctx) => {
      ctx.state.count++;
      return html(
        `<h1>Hello ${params.name}, you are visitor number ${ctx.state.count}</h1>`,
      );
    }),
  ],
});

// Start the server
Deno.serve(myRouter.handle);
```

## Builder Pattern

Pick includes a powerful builder pattern that enables directory-based routing.
The builder walks a directory structure and automatically creates routes from
exported tokens in your files.

### Quick Start

The simplest way to use the builder is with the default `build` export from
`@baetheus/pick`:

```ts
import build from "@baetheus/pick";
import * as R from "@baetheus/pick/router";
import * as Either from "@baetheus/fun/either";

const result = await build(
  "./src/routes", // Root directory to scan
  "My Application", // Site title
  (path) => import(path), // Dynamic import function
);

if (Either.isRight(result)) {
  const routes = result.right.site_routes.map((r) => r.route);
  const router = R.router(R.context({}), { routes });
  Deno.serve(router.handle);
}
```

### Creating Route Files

Route files export tokens created by method builders (`get`, `post`, `put`,
etc.) from `@baetheus/pick/tokens`. Each exported token becomes a route.

```ts
// routes/api/users.ts
import { get, post } from "@baetheus/pick/tokens";
import * as E from "@baetheus/fun/effect";
import * as R from "@baetheus/pick/router";

// GET /api/users
export const list = get(E.gets((req, params, ctx) => {
  return R.json(JSON.stringify([{ id: 1, name: "Alice" }]));
}));

// POST /api/users
export const create = post(E.gets(async (req, params, ctx) => {
  const body = await req.json();
  return R.json(JSON.stringify(body), R.STATUS_CODE.Created);
}));
```

### Path Parameters

The route path is derived from the file's location relative to the root
directory. For example, a file at `routes/users/:id.ts` would create routes
matching `/users/:id`:

```ts
// routes/users/:id.ts
import { del, get } from "@baetheus/pick/tokens";
import * as E from "@baetheus/fun/effect";
import * as R from "@baetheus/pick/router";

// GET /users/:id
export const show = get(E.gets((req, params, ctx) => {
  // params.id is available from the path
  return R.json(JSON.stringify({ id: params.id }));
}));

// DELETE /users/:id
export const remove = del(E.gets((req, params, ctx) => {
  return R.text("Deleted", R.STATUS_CODE.NoContent);
}));
```

### Advanced Configuration

For more control, use the individual builders directly:

```ts
import { build } from "@baetheus/pick/builder";
import { deno_fs } from "@baetheus/pick/deno_fs";
import { server_builder } from "@baetheus/pick/builder_server";
import { static_builder } from "@baetheus/pick/builder_static";

const result = await build({
  root_path: "./src/routes",
  fs: deno_fs,
  unsafe_import: (path) => import(path),
  builders: [
    server_builder({
      middleware: [authMiddleware, loggingMiddleware],
      include_extensions: [".ts"],
    }),
    static_builder({
      exclude_extensions: [".ts", ".tsx"],
    }),
  ],
});
```

## Contributing

Contributions are welcome but this is a young library and I expect to muck
around with it for a good year before I settle the API. Until a 1.0.0 release I
don't expect that the API will really be settled. That said, the basic concepts
are solid so early contributions are likely to last.
