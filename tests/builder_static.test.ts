import { assertEquals } from "@std/assert";
import * as Either from "@baetheus/fun/either";
import * as Effect from "@baetheus/fun/effect";
import * as Option from "@baetheus/fun/option";
import * as Path from "@std/path";

import * as Builder from "../builder.ts";
import * as Router from "../router.ts";
import { static_builder } from "../builder_static.ts";
import { createMockFilesystem, mockFile } from "./builder.test.ts";

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
function unsafe_import(path: string): Promise<unknown> {
  return import(path);
}

// ============================================================================
// static_builder tests
// ============================================================================

Deno.test("static_builder - has correct default name", () => {
  const builder = static_builder({});
  assertEquals(builder.name, "DefaultStaticBuilder");
});

Deno.test("static_builder - uses custom name when provided", () => {
  const builder = static_builder({ name: "MyStaticBuilder" });
  assertEquals(builder.name, "MyStaticBuilder");
});

Deno.test("static_builder - creates route for file", async () => {
  const fs = createMockFilesystem({
    "/root/styles.css": mockFile("body { color: red; }", "text/css"),
  });

  const builder = static_builder({});
  const fileEntry = Builder.file_entry(
    Path.parse("/root/styles.css"),
    "/styles.css",
    Option.some("text/css"),
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 1);
    assertEquals(result.right[0].builder, "DefaultStaticBuilder");
    assertEquals(result.right[0].route.method, "GET");
    assertEquals(result.right[0].route.pathname, "/styles.css");
  }
});

Deno.test("static_builder - excludes files with excluded extensions", async () => {
  const fs = createMockFilesystem({
    "/root/script.ts": mockFile("export const x = 1"),
  });

  const builder = static_builder({ exclude_extensions: [".ts"] });
  const fileEntry = Builder.file_entry(
    Path.parse("/root/script.ts"),
    "/script.ts",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("static_builder - process_build returns empty (no new routes)", async () => {
  const fs = createMockFilesystem();
  const builder = static_builder({});

  const existingRoutes: Builder.SiteRoutes = [
    Builder.full_route(
      "OtherBuilder",
      Path.parse("/other/route.ts"),
      {
        method: "GET",
        pathname: "/other",
        url_pattern: new URLPattern({ pathname: "/other" }),
        handler: Effect.right(new Response("OK")),
      },
    ),
  ];

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const result = await evaluateEffect(
    builder.process_build(existingRoutes),
    config,
  );

  // process_build returns only NEW routes to add (empty for static_builder)
  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

Deno.test("static_builder - route handler reads file content", async () => {
  const fileContent = "body { background: blue; }";
  const fs = createMockFilesystem({
    "/root/styles.css": mockFile(fileContent, "text/css"),
  });

  const builder = static_builder({});
  const fileEntry = Builder.file_entry(
    Path.parse("/root/styles.css"),
    "/styles.css",
    Option.some("text/css"),
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const routeResult = await evaluateEffect(
    builder.process_file(fileEntry),
    config,
  );

  assertEquals(Either.isRight(routeResult), true);
  if (Either.isRight(routeResult)) {
    const route = routeResult.right[0];
    const req = new Request("http://localhost/styles.css");
    const urlResult = { pathname: { groups: {} } } as URLPatternResult;
    const ctx = Router.context({});

    const [handlerResult] = await route.route.handler(req, urlResult, ctx);

    assertEquals(Either.isRight(handlerResult), true);
    if (Either.isRight(handlerResult)) {
      const response = handlerResult.right;
      const body = await response.text();
      assertEquals(body, fileContent);
      assertEquals(response.headers.get("Content-Type"), "text/css");
    }
  }
});

Deno.test("static_builder - sets Content-Type header from mime_type", async () => {
  const fs = createMockFilesystem({
    "/root/image.png": mockFile(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      "image/png",
    ),
  });

  const builder = static_builder({});
  const fileEntry = Builder.file_entry(
    Path.parse("/root/image.png"),
    "/image.png",
    Option.some("image/png"),
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const routeResult = await evaluateEffect(
    builder.process_file(fileEntry),
    config,
  );

  assertEquals(Either.isRight(routeResult), true);
  if (Either.isRight(routeResult)) {
    const route = routeResult.right[0];
    const req = new Request("http://localhost/image.png");
    const urlResult = { pathname: { groups: {} } } as URLPatternResult;
    const ctx = Router.context({});

    const [handlerResult] = await route.route.handler(req, urlResult, ctx);

    assertEquals(Either.isRight(handlerResult), true);
    if (Either.isRight(handlerResult)) {
      const response = handlerResult.right;
      assertEquals(response.headers.get("Content-Type"), "image/png");
    }
  }
});

Deno.test("static_builder - handles files without mime_type", async () => {
  const fs = createMockFilesystem({
    "/root/unknown.xyz": mockFile("data"),
  });

  const builder = static_builder({});
  const fileEntry = Builder.file_entry(
    Path.parse("/root/unknown.xyz"),
    "/unknown.xyz",
    Option.none,
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const routeResult = await evaluateEffect(
    builder.process_file(fileEntry),
    config,
  );

  assertEquals(Either.isRight(routeResult), true);
  if (Either.isRight(routeResult)) {
    assertEquals(routeResult.right.length, 1);
    // Should still create a route even without mime type
    assertEquals(routeResult.right[0].route.pathname, "/unknown.xyz");
  }
});

Deno.test("static_builder - multiple exclude extensions", async () => {
  const fs = createMockFilesystem({
    "/root/script.ts": mockFile("export const x = 1"),
    "/root/test.tsx": mockFile("export const y = 2"),
    "/root/styles.css": mockFile("body {}"),
  });

  const builder = static_builder({ exclude_extensions: [".ts", ".tsx"] });

  const tsEntry = Builder.file_entry(
    Path.parse("/root/script.ts"),
    "/script.ts",
    Option.none,
  );
  const tsxEntry = Builder.file_entry(
    Path.parse("/root/test.tsx"),
    "/test.tsx",
    Option.none,
  );
  const cssEntry = Builder.file_entry(
    Path.parse("/root/styles.css"),
    "/styles.css",
    Option.some("text/css"),
  );

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const tsResult = await evaluateEffect(builder.process_file(tsEntry), config);
  const tsxResult = await evaluateEffect(
    builder.process_file(tsxEntry),
    config,
  );
  const cssResult = await evaluateEffect(
    builder.process_file(cssEntry),
    config,
  );

  // .ts and .tsx should be excluded
  assertEquals(Either.isRight(tsResult) && tsResult.right.length === 0, true);
  assertEquals(Either.isRight(tsxResult) && tsxResult.right.length === 0, true);
  // .css should be included
  assertEquals(Either.isRight(cssResult) && cssResult.right.length === 1, true);
});

Deno.test("static_builder - integration with build function", async () => {
  const fs = createMockFilesystem({
    "/root/index.html": mockFile("<html></html>", "text/html"),
    "/root/styles/main.css": mockFile("body {}", "text/css"),
    "/root/scripts/app.ts": mockFile("export const x = 1"),
  });

  const builder = static_builder({ exclude_extensions: [".ts"] });

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    unsafe_import,
    builders: [builder],
  };

  const result = await Builder.build(config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    // Should have routes for .html and .css, but not .ts
    assertEquals(result.right.site_routes.length, 2);
    const pathnames = result.right.site_routes.map((r) => r.route.pathname);
    assertEquals(pathnames.includes("/index.html"), true);
    assertEquals(pathnames.includes("/styles/main.css"), true);
    assertEquals(pathnames.includes("/scripts/app.ts"), false);
  }
});
