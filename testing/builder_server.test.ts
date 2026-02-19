import { assertEquals } from "@std/assert";
import * as Either from "@baetheus/fun/either";
import * as Effect from "@baetheus/fun/effect";
import * as Option from "@baetheus/fun/option";
import * as Path from "@std/path";

import * as Builder from "../builder.ts";
import * as Router from "../router.ts";
import { safe_import, server_builder } from "../builder_server.ts";
import { createMockFilesystem } from "./builder.test.ts";

// Get absolute path to fixtures directory
const FIXTURES_DIR = new URL("./fixtures", import.meta.url).pathname;

// ============================================================================
// Helper to evaluate BuildEffect
// ============================================================================

async function evaluateEffect<A>(
  effect: Builder.BuildEffect<A>,
  config: Builder.BuildConfig,
): Promise<Either.Either<unknown, A>> {
  const [result] = await effect(config);
  return result;
}

// ============================================================================
// safe_import tests
// ============================================================================

Deno.test("safe_import - imports valid module", async () => {
  const fs = createMockFilesystem();
  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [],
  };

  const parsed = Path.parse(`${FIXTURES_DIR}/server_route.ts`);
  const result = await evaluateEffect(safe_import(parsed), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals("hello" in result.right, true);
  }
});

Deno.test("safe_import - returns error for non-existent file", async () => {
  const fs = createMockFilesystem();
  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [],
  };

  const parsed = Path.parse(`${FIXTURES_DIR}/does_not_exist.ts`);
  const result = await evaluateEffect(safe_import(parsed), config);

  assertEquals(Either.isLeft(result), true);
});

// ============================================================================
// server_builder tests
// ============================================================================

Deno.test("server_builder - has correct default name", () => {
  const builder = server_builder({});
  assertEquals(builder.name, "DefaultServerBuilder");
});

Deno.test("server_builder - uses custom name when provided", () => {
  const builder = server_builder({ name: "MyServerBuilder" });
  assertEquals(builder.name, "MyServerBuilder");
});

Deno.test("server_builder - skips non-included extensions", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({ include_extensions: [".ts", ".tsx"] });

  const fileEntry = Builder.file_entry(
    Path.parse("/root/styles.css"),
    "/styles.css",
    Option.some("text/css"),
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("server_builder - creates route from PartialRoute export", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({});

  const filePath = `${FIXTURES_DIR}/server_route.ts`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/server_route",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 1);
    assertEquals(result.right[0].builder, "DefaultServerBuilder");
    assertEquals(result.right[0].route.method, "GET");
    assertEquals(result.right[0].route.pathname, "/server_route");
  }
});

Deno.test("server_builder - creates multiple routes from multi-export file", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({});

  const filePath = `${FIXTURES_DIR}/server_multi_route.ts`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/api/users",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 3);

    const methods = result.right.map((r) => r.route.method).sort();
    assertEquals(methods, ["DELETE", "GET", "POST"]);

    // All routes should have same pathname (from file path)
    result.right.forEach((route) => {
      assertEquals(route.route.pathname, "/api/users");
    });
  }
});

Deno.test("server_builder - returns empty for files without routes", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({});

  const filePath = `${FIXTURES_DIR}/server_no_routes.ts`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/server_no_routes",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("server_builder - process_build returns empty (no new routes)", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({});

  const existingRoutes: Builder.SiteRoutes = [
    Builder.full_route(
      "OtherBuilder",
      Path.parse("/other.ts"),
      {
        method: "GET",
        pathname: "/other",
        url_pattern: new URLPattern({ pathname: "/other" }),
        handler: Effect.right(new Response("OK")),
      },
    ),
  ];

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const result = await evaluateEffect(
    builder.process_build(existingRoutes),
    config,
  );

  // process_build returns only NEW routes to add (empty for server_builder)
  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("server_builder - route handler returns correct response", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({});

  const filePath = `${FIXTURES_DIR}/server_route.ts`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/server_route",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const routeResult = await evaluateEffect(
    builder.process_file(fileEntry),
    config,
  );

  assertEquals(Either.isRight(routeResult), true);
  if (Either.isRight(routeResult)) {
    const route = routeResult.right[0];
    const req = new Request("http://localhost/server_route");
    const urlResult = { pathname: { groups: {} } } as URLPatternResult;
    const ctx = Router.context({});

    const [handlerResult] = await route.route.handler(req, urlResult, ctx);

    assertEquals(Either.isRight(handlerResult), true);
    if (Either.isRight(handlerResult)) {
      const response = handlerResult.right;
      const body = await response.text();
      assertEquals(body, "Hello from server route");
    }
  }
});

Deno.test("server_builder - applies middleware to routes", async () => {
  const fs = createMockFilesystem();
  const middlewareCalled: string[] = [];

  const testMiddleware: import("../router.ts").Middleware<unknown> = (next) =>
    Effect.gets(async (req, url, ctx) => {
      middlewareCalled.push("before");
      const [result] = await next(req, url, ctx);
      middlewareCalled.push("after");
      return Either.isRight(result) ? result.right : result.left;
    });

  const builder = server_builder({ middleware: [testMiddleware] });

  const filePath = `${FIXTURES_DIR}/server_route.ts`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/server_route",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const routeResult = await evaluateEffect(
    builder.process_file(fileEntry),
    config,
  );

  assertEquals(Either.isRight(routeResult), true);
  if (Either.isRight(routeResult)) {
    const route = routeResult.right[0];
    const req = new Request("http://localhost/server_route");
    const urlResult = { pathname: { groups: {} } } as URLPatternResult;
    const ctx = Router.context({});

    await route.route.handler(req, urlResult, ctx);

    assertEquals(middlewareCalled, ["before", "after"]);
  }
});

Deno.test("server_builder - custom include_extensions", async () => {
  const fs = createMockFilesystem();
  const builder = server_builder({ include_extensions: [".ts"] });

  const tsEntry = Builder.file_entry(
    Path.parse(`${FIXTURES_DIR}/server_route.ts`),
    "/server_route",
    Option.none,
  );

  const tsxEntry = Builder.file_entry(
    Path.parse(`${FIXTURES_DIR}/client_page.tsx`),
    "/client_page",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const tsResult = await evaluateEffect(builder.process_file(tsEntry), config);
  const tsxResult = await evaluateEffect(
    builder.process_file(tsxEntry),
    config,
  );

  // .ts should be processed
  assertEquals(Either.isRight(tsResult), true);
  if (Either.isRight(tsResult)) {
    assertEquals(tsResult.right.length, 1);
  }

  // .tsx should be skipped (not in include_extensions)
  assertEquals(Either.isRight(tsxResult), true);
  if (Either.isRight(tsxResult)) {
    assertEquals(tsxResult.right.length, 0);
  }
});
