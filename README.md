# pick - a somewhat simple router for [Deno](https://deno.land) http servers.

This project aims to provide a simple http server router for Deno that fits my
peculiar vision. In particular, I prefer an http router with the following
properties:

1. Doesn't require any templating tools or automagical project setup.
2. Builds directly on the Deno.ServeHandler, which itself builds on web
   standards.
3. Uses typescript types and request parsing to provide rich types to handlers.
4. Composes very well.

Things that I am willing to give up from existing frameworks:

1. Middleware

If all goes well this project will be rolling out features in stages. Here are
the planned features in no particular order.

* method and path parsing at the type level
* response combinators for rendering jsx, markdown, html, json, etc
* body decoding combinators for forms, json, etc
* response streaming for media
* tools for static site rendering
* tools for api documentation (openapi)
* caching combinators based on request, backend, variables, state, etc
* route and handler generators

## Design Ideas

There are two driving ideas in this library. The first is that we can derive
rich type information from a simple string route definition like "GET /:home" and
use it to route and parse.

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
  readonly variables: V;
}

type RouteHandler<S, V, O> = Handler<Context<S, V>, Response, O>;
```

The Router doesn't really care about the output state `O` of the Handler but we
keep it around in case the user wants to compose Handlers by modifying state.
Lastly, we come to the default type that most users of this library will use. I
call it a `Responder`, but it is really the non-indexed part of `Handler`

```ts
type Responder<D, A> = (d: D) => A | Promise<A>;
```

`Handler` is a effectively a super type of `Responder`. This gets at the root
design idea of pick. Start with a sufficiently powerful type for route handling
that can be trivial "simplified" to a very useful minimal implementation.


## Contributing

Contributions are welcome but this is a young library with a fairly tight goal.
Until a 1.0.0 release I don't expect that the api will really be settled.
