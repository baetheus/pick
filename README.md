# pick - no magic router for [Deno](https://deno.land) http servers.

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
   autodocumenting api framework like oxide comput company's dropshot.

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
// Request is the web standard HTTP request type
// S is the application state
// V is a collection of variables parsed from the request path
type Context<S, V> = {
  readonly request: Request;
  readonly state: S;
  readonly path: V;
};

type RouteHandler<S, V, O> = Handler<Context<S, V>, Response, O>;

// Or, if we substitute the types ourselves
type RouteHandlerSub<S, V, O> = (ctx: Context<S, V>) => Promise<[Response, O]>;
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
import * as R from "../router.ts";
import { html } from "../response.ts";
import { pipe } from "fun/fn.ts";

const router = pipe(
  // Create a Router
  R.router<{ count: number }>(),
  // Add a Route
  R.respond(
    "GET /hello/:name",
    (ctx) =>
      html(
        `<h1>Hello ${ctx.path.name}, you are number ${++ctx.state.count}</h1>`,
      ),
  ),
  R.withState({ count: 0 }),
);

Deno.serve(router);
```

## Contributing

Contributions are welcome but this is a young library and I expect to muck
around with it for a good year before I settle the api. Until a 1.0.0 release I
don't expect that the api will really be settled. That said, the basic concepts
are solid so early contributions are likely to last.
