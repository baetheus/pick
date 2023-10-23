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

The core idea behind the pick router is to build up composable tools from the
following types:

```ts
type Context<S, V> = {
  readonly request: Request,
  readonly state: S,
  readonly variables: V,
};

type Handler<S, V, A = Response> = (ctx: Context<S, V>) => Promise<[Context<S, V>, A]>;

type Parser<S, V> = (req: Request, state: S) => Option<V>;

type Route<S, V> = {
  readonly parser: Parser<S, V>;
  readonly handler: Handler<S, V>;
}
```

A Router is then a collection of Routes. In the first stage of pick the Router is
a simple array of Routes, which is iterated through and each Parser is applied.
If the Parser returns a Some, then the route is considered Matched and the
Handler is invoked.

In the future I intend to explore radix trees and other data structures for
deciding the route to use and for building more complex parser/handler
combinations.

## Contributing

Contributions are welcome but this is a young library with a fairly tight goal.
Until a 1.0.0 release I don't expect that the api will really be settled.
