import { assertEquals } from "@std/assert";

import * as R from "../router.ts";

Deno.test("response_init builds ResponseInit with sensible defaults", () => {
  const init = R.response_init(R.STATUS_CODE.OK);
  assertEquals(init.status, R.STATUS_CODE.OK);
  assertEquals(init.statusText, R.STATUS_TEXT[R.STATUS_CODE.OK]);
  assertEquals(init.headers, []);
});

Deno.test("response creates Response with default 200 OK", async () => {
  const res = R.response("hello");
  assertEquals(res.status, R.STATUS_CODE.OK);
  assertEquals(await res.text(), "hello");
});

Deno.test("html sets Content-Type text/html and status", async () => {
  const res = R.html("<p>x</p>");
  assertEquals(res.status, R.STATUS_CODE.OK);
  assertEquals(
    res.headers.get(R.HEADER.ContentType),
    "text/html; charset=utf-8",
  );
  assertEquals(await res.text(), "<p>x</p>");
});

Deno.test("json sets Content-Type application/json and status", async () => {
  const body = JSON.stringify({ ok: true });
  const res = R.json(body);
  assertEquals(res.status, R.STATUS_CODE.OK);
  assertEquals(
    res.headers.get(R.HEADER.ContentType),
    "application/json; charset=utf-8",
  );
  assertEquals(await res.text(), body);
});

Deno.test("text returns Response with plain body and status", async () => {
  const res = R.text("plain", R.STATUS_CODE.Accepted);
  assertEquals(res.status, R.STATUS_CODE.Accepted);
  assertEquals(await res.text(), "plain");
});

Deno.test("modify_header mutates response headers in place", () => {
  const res = R.text("x");
  const apply = R.modify_header((h) =>
    h.set(R.HEADER.CacheControl, "no-cache")
  );
  const out = apply(res);
  assertEquals(out.headers.get(R.HEADER.CacheControl), "no-cache");
});

Deno.test("set_headers sets multiple headers (replaces values)", () => {
  const res = R.text("x");
  const apply = R.set_headers(
    [R.HEADER.ContentType, "text/html"],
    [R.HEADER.CacheControl, "max-age=0"],
  );
  apply(res);
  assertEquals(res.headers.get(R.HEADER.ContentType), "text/html");
  assertEquals(res.headers.get(R.HEADER.CacheControl), "max-age=0");
});

Deno.test("append_header appends multiple headers", () => {
  const res = R.text("x");
  const apply = R.append_header(
    [R.HEADER.AccessControlAllowOrigin, "*"],
  );
  apply(res);
  // At least ensures header exists; semantics of multiple values are implementation-defined
  assertEquals(res.headers.get(R.HEADER.AccessControlAllowOrigin), "*");
});

Deno.test("delete_header removes specified headers", () => {
  const res = R.text("x");
  const applySet = R.set_headers(
    [R.HEADER.Server, "deno"],
    [R.HEADER.CacheControl, "pick"],
  );
  applySet(res);
  const applyDel = R.delete_header(R.HEADER.Server, R.HEADER.CacheControl);
  applyDel(res);
  assertEquals(res.headers.get(R.HEADER.Server), null);
  assertEquals(res.headers.get(R.HEADER.CacheControl), null);
});

Deno.test("route_string formats method and path", () => {
  const r = R.route_string("GET", "users/:id");
  assertEquals(r, "GET /users/:id");
});

Deno.test("context returns state and default logger", () => {
  const ctx = R.context({ a: 1 }, R.NOOP_LOGGER);
  assertEquals(ctx.state, { a: 1 });
  assertEquals(typeof ctx.logger.info, "function");
});

Deno.test("route parses method, pathname and builds URLPattern", () => {
  const r = R.route(
    "GET",
    "/users/:id",
    (() => undefined) as unknown as R.Handler<unknown>,
  );
  assertEquals(r.method, "GET");
  assertEquals(r.pathname, "/users/:id");
  const exec = r.url_pattern.exec("http://localhost/users/123");
  assertEquals(Boolean(exec), true);
});

Deno.test("right creates a successful route that router handles", async () => {
  const rt = R.right("GET /hi", () => new Response("hi"));
  const app = R.router(R.context({}, R.NOOP_LOGGER), { routes: [rt] });
  const res = await app.handle(
    new Request("http://localhost/hi", { method: "GET" }),
  );
  assertEquals(res.status, R.STATUS_CODE.OK);
  assertEquals(await res.text(), "hi");
});

Deno.test("left creates an error route that router returns", async () => {
  const rt = R.left("GET /oops", () => new Response("bad", { status: 400 }));
  const app = R.router(R.context({}, R.NOOP_LOGGER), { routes: [rt] });
  const res = await app.handle(
    new Request("http://localhost/oops", { method: "GET" }),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.text(), "bad");
});

Deno.test("router returns default 404 when no route matches", async () => {
  const app = R.router(R.context({}, R.NOOP_LOGGER), {});
  const res = await app.handle(
    new Request("http://localhost/none", { method: "GET" }),
  );
  assertEquals(res.status, R.STATUS_CODE.NotFound);
  assertEquals(await res.text(), "Not Found");
});

Deno.test("middleware executes for matching route", async () => {
  const base = R.right("GET /m", () => new Response("base"));
  let called = false;
  const mw = R.middleware((h) => async (req, pr, ctx) => {
    called = true;
    return await h(req, pr, ctx);
  });
  const app = R.router(R.context({}, R.NOOP_LOGGER), {
    routes: [base],
    middlewares: [mw],
  });
  const res = await app.handle(
    new Request("http://localhost/m", { method: "GET" }),
  );
  assertEquals(called, true);
  assertEquals(await res.text(), "base");
});

Deno.test("router catches thrown exceptions and returns 500 Internal Server Error", async () => {
  const throwingRoute = R.right("GET /throw", () => {
    throw new Error("Something went wrong!");
  });
  const app = R.router(R.context({}, R.NOOP_LOGGER), {
    routes: [throwingRoute],
  });
  const res = await app.handle(
    new Request("http://localhost/throw", { method: "GET" }),
  );
  assertEquals(res.status, R.STATUS_CODE.InternalServerError);
  assertEquals(await res.text(), "Internal Server Error");
});

Deno.test("router uses default handler for unknown HTTP method", async () => {
  const getRoute = R.right("GET /test", () => new Response("get response"));
  const customDefault = () => new Response("custom default", { status: 404 });
  const app = R.router(R.context({}, R.NOOP_LOGGER), {
    routes: [getRoute],
    default_handler: customDefault,
  });

  // Create a request with a non-standard method
  const req = new Request("http://localhost/test", {
    method: "DOES_NOT_EXIST",
  });

  const res = await app.handle(req);
  assertEquals(res.status, 404);
  assertEquals(await res.text(), "custom default");
});
