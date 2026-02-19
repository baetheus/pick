import { assertEquals } from "@std/assert";
import * as Either from "@baetheus/fun/either";
import * as Option from "@baetheus/fun/option";
import * as Path from "@std/path";

import * as Builder from "../builder.ts";
import * as Router from "../router.ts";
import { client_builder } from "../builder_client.ts";
import { deno_fs } from "../deno_fs.ts";
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
// client_builder basic tests
// ============================================================================

Deno.test("client_builder - has correct default name", () => {
  const builder = client_builder({});
  assertEquals(builder.name, "DefaultClientBuilder");
});

Deno.test("client_builder - uses custom name when provided", () => {
  const builder = client_builder({ name: "MyClientBuilder" });
  assertEquals(builder.name, "MyClientBuilder");
});

Deno.test("client_builder - skips non-included extensions", async () => {
  const fs = createMockFilesystem();
  const builder = client_builder({ include_extensions: [".ts", ".tsx"] });

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

// ============================================================================
// process_file tests - token detection
// ============================================================================

Deno.test("client_builder - process_file returns empty (routes created in process_build)", async () => {
  const fs = createMockFilesystem();
  const builder = client_builder({});

  const filePath = `${FIXTURES_DIR}/client_page.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/client_page",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  // process_file always returns empty array; routes are created in process_build
  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("client_builder - detects client_route exports", async () => {
  // Use real filesystem for tests involving esbuild bundling
  const builder = client_builder();

  const filePath = `${FIXTURES_DIR}/client_page.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/pages/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  // Process the file to detect exports
  await evaluateEffect(builder.process_file(fileEntry), config);

  // Now call process_build - it should create routes based on detected exports
  const buildResult = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(buildResult), true);
  if (Either.isRight(buildResult)) {
    // Should have routes: root (/), the client page route, and bundle assets
    assertEquals(buildResult.right.length >= 2, true);

    // Find the page route (not / and not an asset path)
    const pageRoute = buildResult.right.find(
      (r) =>
        r.route.pathname === "/pages/home" ||
        r.route.pathname.includes("home"),
    );
    assertEquals(pageRoute !== undefined, true);
  }
});

// ============================================================================
// process_build validation tests
// ============================================================================

Deno.test("client_builder - process_build returns empty when no routes detected", async () => {
  const fs = createMockFilesystem();
  const builder = client_builder({});

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs,
    builders: [builder],
  };

  // Don't process any files, just call process_build directly
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("client_builder - errors on multiple client_wrapper exports", async () => {
  // Use real filesystem for esbuild bundling
  const builder = client_builder({});

  const filePath = `${FIXTURES_DIR}/client_multi_wrapper.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/wrapper",
    Option.none,
  );

  // Also need a route file to trigger process_build
  const routePath = `${FIXTURES_DIR}/client_page.tsx`;
  const routeEntry = Builder.file_entry(
    Path.parse(routePath),
    "/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  // Process files
  await evaluateEffect(builder.process_file(fileEntry), config);
  await evaluateEffect(builder.process_file(routeEntry), config);

  // process_build should error due to multiple wrappers
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isLeft(result), true);
  if (Either.isLeft(result)) {
    const error = result.left as { tag: string };
    assertEquals(error.tag, "ClientBuilderError");
  }
});

// ============================================================================
// Route generation tests
// ============================================================================

Deno.test("client_builder - generates root route", async () => {
  // Use real filesystem for esbuild bundling
  const builder = client_builder({});

  const filePath = `${FIXTURES_DIR}/client_page.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  await evaluateEffect(builder.process_file(fileEntry), config);
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    const rootRoute = result.right.find((r) => r.route.pathname === "/");
    assertEquals(rootRoute !== undefined, true);
    assertEquals(rootRoute?.route.method, "GET");
  }
});

Deno.test("client_builder - all page routes serve index.html", async () => {
  // Use real filesystem for esbuild bundling
  const builder = client_builder({
    title: "Test App",
  });

  const filePath = `${FIXTURES_DIR}/client_page.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  await evaluateEffect(builder.process_file(fileEntry), config);
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    // Find non-asset routes (root and page routes)
    const pageRoutes = result.right.filter(
      (r) => !r.route.pathname.includes("-") && !r.route.pathname.includes("."),
    );

    for (const route of pageRoutes) {
      const req = new Request(`http://localhost${route.route.pathname}`);
      const urlResult = { pathname: { groups: {} } } as URLPatternResult;
      const ctx = Router.context({});

      const [handlerResult] = await route.route.handler(req, urlResult, ctx);

      assertEquals(Either.isRight(handlerResult), true);
      if (Either.isRight(handlerResult)) {
        const response = handlerResult.right;
        const contentType = response.headers.get("Content-Type");
        assertEquals(contentType?.includes("text/html"), true);

        const body = await response.text();
        assertEquals(body.includes("<!DOCTYPE html>"), true);
        assertEquals(body.includes("Test App"), true);
      }
    }
  }
});

Deno.test("client_builder - generates asset routes from esbuild output", async () => {
  // Use real filesystem for esbuild bundling
  const builder = client_builder({});

  const filePath = `${FIXTURES_DIR}/client_page.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  await evaluateEffect(builder.process_file(fileEntry), config);
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    // Find JS asset routes (contain hash and end with .js)
    const jsRoutes = result.right.filter((r) =>
      r.route.pathname.endsWith(".js")
    );

    assertEquals(jsRoutes.length >= 1, true);

    // Check that JS routes serve JavaScript content
    for (const route of jsRoutes) {
      const req = new Request(`http://localhost${route.route.pathname}`);
      const urlResult = { pathname: { groups: {} } } as URLPatternResult;
      const ctx = Router.context({});

      const [handlerResult] = await route.route.handler(req, urlResult, ctx);

      assertEquals(Either.isRight(handlerResult), true);
      if (Either.isRight(handlerResult)) {
        const response = handlerResult.right;
        assertEquals(response.status, 200);
      }
    }
  }
});

// ============================================================================
// Default route (SPA fallback) tests
// ============================================================================

Deno.test("client_builder - adds wildcard route when client_default exists", async () => {
  // Use real filesystem for esbuild bundling
  const builder = client_builder({});

  // Process a regular route
  const pageEntry = Builder.file_entry(
    Path.parse(`${FIXTURES_DIR}/client_page.tsx`),
    "/home",
    Option.none,
  );

  // Process the default route
  const defaultEntry = Builder.file_entry(
    Path.parse(`${FIXTURES_DIR}/client_default.tsx`),
    "/not-found",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  await evaluateEffect(builder.process_file(pageEntry), config);
  await evaluateEffect(builder.process_file(defaultEntry), config);
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    const wildcardRoute = result.right.find((r) => r.route.pathname === "/*");
    assertEquals(wildcardRoute !== undefined, true);
    assertEquals(wildcardRoute?.route.method, "GET");
  }
});

Deno.test("client_builder - no wildcard route without client_default", async () => {
  // Use real filesystem for esbuild bundling
  const builder = client_builder({});

  // Only process a regular route, no default
  const pageEntry = Builder.file_entry(
    Path.parse(`${FIXTURES_DIR}/client_page.tsx`),
    "/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  await evaluateEffect(builder.process_file(pageEntry), config);
  const result = await evaluateEffect(builder.process_build([]), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    const wildcardRoute = result.right.find((r) => r.route.pathname === "/*");
    assertEquals(wildcardRoute, undefined);
  }
});

// ============================================================================
// Options tests
// ============================================================================

Deno.test("client_builder - respects title option in generated HTML", async () => {
  // Use real filesystem for esbuild bundling
  const customTitle = "My Custom App Title";
  const builder = client_builder({
    title: customTitle,
  });

  const filePath = `${FIXTURES_DIR}/client_page.tsx`;
  const fileEntry = Builder.file_entry(
    Path.parse(filePath),
    "/home",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    builders: [builder],
  };

  await evaluateEffect(builder.process_file(fileEntry), config);
  const processBuildResult = await evaluateEffect(
    builder.process_build([]),
    config,
  );

  assertEquals(Either.isRight(processBuildResult), true);
  if (Either.isRight(processBuildResult)) {
    const rootRoute = processBuildResult.right.find((r) =>
      r.route.pathname === "/"
    );
    assertEquals(rootRoute !== undefined, true);

    if (rootRoute) {
      const req = new Request("http://localhost/");
      const urlResult = { pathname: { groups: {} } } as URLPatternResult;
      const ctx = Router.context({});

      const [handlerResult] = await rootRoute.route.handler(
        req,
        urlResult,
        ctx,
      );

      assertEquals(Either.isRight(handlerResult), true);
      if (Either.isRight(handlerResult)) {
        const body = await handlerResult.right.text();
        assertEquals(body.includes(customTitle), true);
      }
    }
  }
});

Deno.test("client_builder - custom include_extensions", async () => {
  const fs = createMockFilesystem();
  const builder = client_builder({ include_extensions: [".tsx"] });

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

  // .ts should be skipped (returns immediately with empty)
  const tsResult = await evaluateEffect(builder.process_file(tsEntry), config);
  assertEquals(Either.isRight(tsResult), true);
  if (Either.isRight(tsResult)) {
    assertEquals(tsResult.right.length, 0);
  }

  // .tsx should be processed (but process_file returns empty, routes in process_build)
  const tsxResult = await evaluateEffect(
    builder.process_file(tsxEntry),
    config,
  );
  assertEquals(Either.isRight(tsxResult), true);
});
