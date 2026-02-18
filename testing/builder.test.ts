import { assertEquals, assertExists } from "@std/assert";
import * as E from "fun/effect";
import * as Either from "fun/either";
import * as O from "fun/option";
import { schema } from "fun/schemable";

import * as B from "../builder.ts";
import * as R from "../router.ts";
import * as T from "../tokens.ts";

// =============================================================================
// Test Utilities and Mocks
// =============================================================================

function mock_handler<D>(): R.Handler<D> {
  return E.gets(() => R.text("test"));
}

const isRight = Either.isRight;
const isLeft = Either.isLeft;
const isSome = O.isSome;
const isNone = O.isNone;

function create_file_entry(
  absolute_path: string,
  relative_path: string,
  extension: string,
  mime_type: O.Option<string> = O.none,
): B.FileEntry {
  return B.file_entry(
    absolute_path,
    relative_path,
    absolute_path.split("/").pop() ?? "",
    extension,
    mime_type,
    async () => new ReadableStream(),
  );
}

// =============================================================================
// file_entry tests
// =============================================================================

Deno.test("file_entry creates a FileEntry with all properties", () => {
  const entry = B.file_entry(
    "/abs/path/file.ts",
    "file.ts",
    "file.ts",
    ".ts",
    O.some("text/typescript"),
    async () => new ReadableStream(),
  );

  assertEquals(entry.absolute_path, "/abs/path/file.ts");
  assertEquals(entry.relative_path, "file.ts");
  assertEquals(entry.filename, "file.ts");
  assertEquals(entry.extension, ".ts");
  assertEquals(entry.mime_type, O.some("text/typescript"));
  assertExists(entry.stream);
});

// =============================================================================
// parse_path tests
// =============================================================================

Deno.test("parse_path strips .ts extension", () => {
  assertEquals(B.parse_path("users.ts", [".ts"]), "/users");
});

Deno.test("parse_path strips .tsx extension", () => {
  assertEquals(B.parse_path("component.tsx", [".tsx", ".ts"]), "/component");
});

Deno.test("parse_path handles nested paths", () => {
  assertEquals(B.parse_path("api/users/index.ts", [".ts"]), "/api/users/index");
});

Deno.test("parse_path preserves path params", () => {
  assertEquals(B.parse_path(":id/details.ts", [".ts"]), "/:id/details");
});

Deno.test("parse_path handles wildcard filename", () => {
  assertEquals(B.parse_path("api/*.ts", [".ts"]), "/api/*");
});

Deno.test("parse_path handles bare wildcard", () => {
  assertEquals(B.parse_path("*", [".ts"]), "/*");
});

Deno.test("parse_path adds leading slash when missing", () => {
  assertEquals(B.parse_path("users", []), "/users");
});

Deno.test("parse_path preserves existing leading slash", () => {
  assertEquals(B.parse_path("/users.ts", [".ts"]), "/users");
});

Deno.test("parse_path with no matching extension", () => {
  assertEquals(B.parse_path("users.js", [".ts"]), "/users.js");
});

// =============================================================================
// count_params tests
// =============================================================================

Deno.test("count_params returns 0 for static path", () => {
  assertEquals(B.count_params("/users/list"), 0);
});

Deno.test("count_params counts single param", () => {
  assertEquals(B.count_params("/users/:id"), 1);
});

Deno.test("count_params counts multiple params", () => {
  assertEquals(B.count_params("/users/:userId/posts/:postId"), 2);
});

Deno.test("count_params counts wildcards", () => {
  assertEquals(B.count_params("/files/*"), 1);
});

Deno.test("count_params counts both params and wildcards", () => {
  assertEquals(B.count_params("/users/:id/*"), 2);
});

// =============================================================================
// compare_specificity tests
// =============================================================================

Deno.test("compare_specificity returns negative when a is more specific", () => {
  const result = B.compare_specificity("/users", "/users/:id");
  assertEquals(result < 0, true);
});

Deno.test("compare_specificity returns positive when b is more specific", () => {
  const result = B.compare_specificity("/users/:id", "/users");
  assertEquals(result > 0, true);
});

Deno.test("compare_specificity returns 0 for equal specificity", () => {
  assertEquals(B.compare_specificity("/users/:id", "/posts/:id"), 0);
});

// =============================================================================
// partial_route tests
// =============================================================================

Deno.test("partial_route creates PartialRoute without schema", () => {
  const handler = mock_handler();
  const pr = B.partial_route("GET", handler);

  assertEquals(pr.type, "PARTIAL_ROUTE");
  assertEquals(pr.method, "GET");
  assertEquals(pr.handler, handler);
  assertEquals(pr.params_schema, O.none);
});

Deno.test("partial_route creates PartialRoute with schema", () => {
  const handler = mock_handler();
  const testSchema = schema((s) => s.struct({ id: s.string() }));
  const pr = B.partial_route("POST", handler, O.some(testSchema));

  assertEquals(pr.type, "PARTIAL_ROUTE");
  assertEquals(pr.method, "POST");
  assertEquals(pr.params_schema.tag, "Some");
});

// =============================================================================
// is_partial_route tests
// =============================================================================

Deno.test("is_partial_route returns true for valid PartialRoute", () => {
  const pr = B.partial_route("GET", mock_handler());
  assertEquals(B.is_partial_route(pr), true);
});

Deno.test("is_partial_route returns false for non-record", () => {
  assertEquals(B.is_partial_route("not a route"), false);
  assertEquals(B.is_partial_route(42), false);
  assertEquals(B.is_partial_route(null), false);
  assertEquals(B.is_partial_route(undefined), false);
});

Deno.test("is_partial_route returns false for record without type", () => {
  assertEquals(B.is_partial_route({ method: "GET" }), false);
});

Deno.test("is_partial_route returns false for wrong type value", () => {
  assertEquals(B.is_partial_route({ type: "WRONG_TYPE" }), false);
});

// =============================================================================
// Method builder tests (get, post, put, delete_, patch, head, options)
// =============================================================================

Deno.test("get creates GET PartialRoute with handler", () => {
  const handler = mock_handler();
  const pr = T.get(handler);

  assertEquals(pr.method, "GET");
  assertEquals(pr.params_schema, O.none);
});

Deno.test("get creates GET PartialRoute with config", () => {
  const handler = mock_handler();
  const testSchema = schema((s) => s.struct({ id: s.string() }));
  const pr = T.get({ params: testSchema, handler });

  assertEquals(pr.method, "GET");
  assertEquals(pr.params_schema.tag, "Some");
});

Deno.test("post creates POST PartialRoute", () => {
  assertEquals(T.post(mock_handler()).method, "POST");
});

Deno.test("put creates PUT PartialRoute", () => {
  assertEquals(T.put(mock_handler()).method, "PUT");
});

Deno.test("delete_ creates DELETE PartialRoute", () => {
  assertEquals(T.delete_(mock_handler()).method, "DELETE");
});

Deno.test("patch creates PATCH PartialRoute", () => {
  assertEquals(T.patch(mock_handler()).method, "PATCH");
});

Deno.test("head creates HEAD PartialRoute", () => {
  assertEquals(T.head(mock_handler()).method, "HEAD");
});

Deno.test("options creates OPTIONS PartialRoute", () => {
  assertEquals(T.options(mock_handler()).method, "OPTIONS");
});

// =============================================================================
// client_page tests
// =============================================================================

Deno.test("client_page creates ClientPage marker", () => {
  function TestComponent() {
    return null;
  }
  const cp = T.client_page("Test Title", TestComponent);

  assertEquals(cp.type, "CLIENT_PAGE");
  assertEquals(cp.title, "Test Title");
  assertEquals(cp.component, TestComponent);
});

// =============================================================================
// is_client_page tests
// =============================================================================

Deno.test("is_client_page returns true for valid ClientPage", () => {
  function TestComponent() {
    return null;
  }
  const cp = T.client_page("Test", TestComponent);
  assertEquals(T.is_client_page(cp), true);
});

Deno.test("is_client_page returns false for non-record", () => {
  assertEquals(T.is_client_page("not a page"), false);
  assertEquals(T.is_client_page(42), false);
  assertEquals(T.is_client_page(null), false);
});

Deno.test("is_client_page returns false for record without type", () => {
  assertEquals(T.is_client_page({ title: "Test" }), false);
});

Deno.test("is_client_page returns false for wrong type value", () => {
  assertEquals(T.is_client_page({ type: "WRONG_TYPE" }), false);
});

// =============================================================================
// index_page tests
// =============================================================================

Deno.test("index_page creates IndexPage marker", () => {
  function TestShell() {
    return null;
  }
  const ip = T.index_page(TestShell);

  assertEquals(ip.type, "INDEX_PAGE");
  assertEquals(ip.component, TestShell);
});

// =============================================================================
// is_index_page tests
// =============================================================================

Deno.test("is_index_page returns true for valid IndexPage", () => {
  function TestShell() {
    return null;
  }
  const ip = T.index_page(TestShell);
  assertEquals(T.is_index_page(ip), true);
});

Deno.test("is_index_page returns false for non-record", () => {
  assertEquals(T.is_index_page("not a page"), false);
  assertEquals(T.is_index_page(null), false);
});

Deno.test("is_index_page returns false for wrong type value", () => {
  assertEquals(T.is_index_page({ type: "WRONG_TYPE" }), false);
});

// =============================================================================
// tagged_route, static_route, client_route, server_route tests
// =============================================================================

Deno.test("tagged_route creates TaggedRoute with all properties", () => {
  const route = R.route("GET", "/test", mock_handler());
  const tr = B.tagged_route("TestTag", "/path/file.ts", route, "test_builder");

  assertEquals(tr.tag, "TestTag");
  assertEquals(tr.absolute_path, "/path/file.ts");
  assertEquals(tr.route, route);
  assertEquals(tr.builder, "test_builder");
});

Deno.test("static_route creates StaticRoute with default builder", () => {
  const route = R.route("GET", "/test", mock_handler());
  const sr = B.static_route("/path/file.txt", route);

  assertEquals(sr.tag, "StaticRoute");
  assertEquals(sr.builder, "static_builder");
});

Deno.test("static_route creates StaticRoute with custom builder", () => {
  const route = R.route("GET", "/test", mock_handler());
  const sr = B.static_route("/path/file.txt", route, "custom_builder");

  assertEquals(sr.builder, "custom_builder");
});

Deno.test("client_route creates ClientRoute with default builder", () => {
  const route = R.route("GET", "/test", mock_handler());
  const cr = B.client_route("/path/app.tsx", route);

  assertEquals(cr.tag, "ClientRoute");
  assertEquals(cr.builder, "client_builder");
});

Deno.test("server_route creates ServerRoute with default builder", () => {
  const route = R.route("GET", "/test", mock_handler());
  const sr = B.server_route("/path/api.ts", route);

  assertEquals(sr.tag, "ServerRoute");
  assertEquals(sr.builder, "server_builder");
});

// =============================================================================
// site_routes tests
// =============================================================================

Deno.test("site_routes creates empty SiteRoutes by default", () => {
  const sr = B.site_routes();

  assertEquals(sr.static_routes, []);
  assertEquals(sr.client_routes, []);
  assertEquals(sr.server_routes, []);
});

Deno.test("site_routes creates SiteRoutes with initial values", () => {
  const route = R.route("GET", "/test", mock_handler());
  const staticRoute = B.static_route("/file.txt", route);
  const clientRoute = B.client_route("/app.tsx", route);
  const serverRoute = B.server_route("/api.ts", route);

  const sr = B.site_routes({
    static_routes: [staticRoute],
    client_routes: [clientRoute],
    server_routes: [serverRoute],
  });

  assertEquals(sr.static_routes.length, 1);
  assertEquals(sr.client_routes.length, 1);
  assertEquals(sr.server_routes.length, 1);
});

// =============================================================================
// get_initializable_site_routes tests
// =============================================================================

Deno.test("get_initializable_site_routes combines SiteRoutes", () => {
  const { combine, init } = B.get_initializable_site_routes();

  assertEquals(init().static_routes, []);

  const route = R.route("GET", "/test", mock_handler());
  const sr1 = B.site_routes({
    server_routes: [B.server_route("/a.ts", route)],
  });
  const sr2 = B.site_routes({
    server_routes: [B.server_route("/b.ts", route)],
  });

  const combined = combine(sr1)(sr2);
  assertEquals(combined.server_routes.length, 2);
});

// =============================================================================
// from_site_routes tests
// =============================================================================

Deno.test("from_site_routes returns routes sorted by specificity", () => {
  const handler = mock_handler();
  const route1 = R.route("GET", "/users", handler);
  const route2 = R.route("GET", "/users/:id", handler);
  const route3 = R.route("GET", "/static", handler);

  const sr = B.site_routes({
    server_routes: [
      B.server_route("/b.ts", route2),
      B.server_route("/a.ts", route1),
    ],
    static_routes: [B.static_route("/s.txt", route3)],
    client_routes: [],
  });

  const routes = B.from_site_routes(sr);

  // Server routes come first, sorted by specificity
  assertEquals(routes[0].pathname, "/users");
  assertEquals(routes[1].pathname, "/users/:id");
  // Then static routes
  assertEquals(routes[2].pathname, "/static");
});

// =============================================================================
// Error factory tests
// =============================================================================

Deno.test("route_build_error creates error with context", () => {
  const err = B.route_build_error("Test message", { path: "/test" });

  assertEquals(err.tag, "Error");
  assertEquals(err.name, "RouteBuildError");
  assertEquals(err.message, "Test message");
  assertEquals(err.context?.path, "/test");
});

Deno.test("route_conflict_error creates error", () => {
  const err = B.route_conflict_error("Conflict", {
    existing: "/a",
    conflict: "/b",
  });

  assertEquals(err.name, "RouteConflictError");
});

Deno.test("client_bundle_error creates error", () => {
  const err = B.client_bundle_error("Bundle failed", {
    entrypoint: "/app.tsx",
  });

  assertEquals(err.name, "ClientBundleError");
});

// =============================================================================
// from_partial_route tests
// =============================================================================

Deno.test("from_partial_route converts PartialRoute without schema", () => {
  const handler = mock_handler();
  const pr = B.partial_route("GET", handler);
  const route = B.from_partial_route("/users", pr);

  assertEquals(route.method, "GET");
  assertEquals(route.pathname, "/users");
});

Deno.test("from_partial_route converts PartialRoute with schema - valid params", async () => {
  const testSchema = schema((s) => s.struct({ id: s.string() }));
  const handler = E.gets((_req: Request, pattern: URLPatternResult) => {
    return R.text(`ID: ${pattern.pathname.groups.id}`);
  });

  const pr = B.partial_route("GET", handler, O.some(testSchema));
  const route = B.from_partial_route("/users/:id", pr);

  // Create a mock request and pattern
  const req = new Request("http://localhost/users/123");
  const urlPattern = new URLPattern({ pathname: "/users/:id" });
  const pattern = urlPattern.exec(req.url)!;

  const ctx = R.context({}, R.NOOP_LOGGER);
  const [result] = await route.handler(req, pattern, ctx);

  assertEquals(isRight(result), true);
  if (isRight(result)) {
    const text = await result.right.text();
    assertEquals(text, "ID: 123");
  }
});

Deno.test("from_partial_route with schema - invalid params returns 400", async () => {
  // Schema expects id to be present
  const testSchema = schema((s) => s.struct({ id: s.number() }));
  const handler = E.gets(() => R.text("success"));

  const pr = B.partial_route("GET", handler, O.some(testSchema));
  const route = B.from_partial_route("/users/:id", pr);

  const req = new Request("http://localhost/users/abc");
  const urlPattern = new URLPattern({ pathname: "/users/:id" });
  const pattern = urlPattern.exec(req.url)!; // id: "abc" - not a valid number

  const ctx = R.context({}, R.NOOP_LOGGER);
  const [result] = await route.handler(req, pattern, ctx);

  assertEquals(isLeft(result), true);
  if (isLeft(result)) {
    assertEquals(result.left.status, 400);
  }
});

// =============================================================================
// safe_import tests
// =============================================================================

Deno.test("safe_import imports valid module", async () => {
  // Import this test file itself
  const testPath = new URL(import.meta.url).pathname;
  const [result] = await B.safe_import(testPath);

  assertEquals(isRight(result), true);
});

Deno.test("safe_import handles file:// prefix", async () => {
  const testPath = import.meta.url; // Already has file://
  const [result] = await B.safe_import(testPath);

  assertEquals(isRight(result), true);
});

Deno.test("safe_import returns error for non-existent file", async () => {
  const [result] = await B.safe_import("/non/existent/path.ts");

  assertEquals(isLeft(result), true);
  if (isLeft(result)) {
    assertEquals(result.left.name, "RouteBuildError");
  }
});

// =============================================================================
// build_server_routes tests
// =============================================================================

Deno.test("build_server_routes returns None for non-matching extension", async () => {
  const entry = create_file_entry("/path/file.tsx", "file.tsx", ".tsx");
  const config: B.SiteConfig = {
    root_path: "/path",
    state: null,
    logger: R.NOOP_LOGGER,
    server_extensions: [".ts"], // Only .ts, not .tsx
  };

  const effect = B.build_server_routes(entry, config);
  const [result] = await effect();

  assertEquals(isRight(result), true);
  if (isRight(result)) {
    assertEquals(isNone(result.right), true);
  }
});

// =============================================================================
// build_static_routes tests
// =============================================================================

Deno.test("build_static_routes creates route with mime type", async () => {
  const entry = create_file_entry(
    "/path/style.css",
    "style.css",
    ".css",
    O.some("text/css"),
  );
  const config: B.SiteConfig = {
    root_path: "/path",
    state: null,
    logger: R.NOOP_LOGGER,
  };

  const effect = B.build_static_routes(entry, config);
  const [result] = await effect();

  assertEquals(isRight(result), true);
  if (isRight(result)) {
    assertEquals(isSome(result.right), true);
    if (isSome(result.right)) {
      assertEquals(result.right.value.static_routes.length, 1);
      assertEquals(
        result.right.value.static_routes[0].route.pathname,
        "/style.css",
      );
    }
  }
});

Deno.test("build_static_routes creates route without mime type", async () => {
  const entry = create_file_entry(
    "/path/unknown.xyz",
    "unknown.xyz",
    ".xyz",
    O.none,
  );
  const config: B.SiteConfig = {
    root_path: "/path",
    state: null,
    logger: R.NOOP_LOGGER,
  };

  const effect = B.build_static_routes(entry, config);
  const [result] = await effect();

  assertEquals(isRight(result), true);
  if (isRight(result)) {
    assertEquals(isSome(result.right), true);
  }
});

Deno.test("build_static_routes handler returns response with mime type", async () => {
  const entry = B.file_entry(
    "/path/style.css",
    "style.css",
    "style.css",
    ".css",
    O.some("text/css"),
    async () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("body { }"));
          controller.close();
        },
      }),
  );
  const config: B.SiteConfig = {
    root_path: "/path",
    state: null,
    logger: R.NOOP_LOGGER,
  };

  const effect = B.build_static_routes(entry, config);
  const [result] = await effect();

  if (isRight(result) && isSome(result.right)) {
    const route = result.right.value.static_routes[0].route;
    const req = new Request("http://localhost/style.css");
    const pattern = route.url_pattern.exec(req.url)!;
    const ctx = R.context(null, R.NOOP_LOGGER);

    const [handlerResult] = await route.handler(req, pattern, ctx);
    assertEquals(isRight(handlerResult), true);
    if (isRight(handlerResult)) {
      assertEquals(handlerResult.right.headers.get("Content-Type"), "text/css");
    }
  }
});

Deno.test("build_static_routes handler returns error on stream failure", async () => {
  const entry = B.file_entry(
    "/path/broken.css",
    "broken.css",
    "broken.css",
    ".css",
    O.some("text/css"),
    async () => {
      throw new Error("Stream error");
    },
  );
  const config: B.SiteConfig = {
    root_path: "/path",
    state: null,
    logger: R.NOOP_LOGGER,
  };

  const effect = B.build_static_routes(entry, config);
  const [result] = await effect();

  if (isRight(result) && isSome(result.right)) {
    const route = result.right.value.static_routes[0].route;
    const req = new Request("http://localhost/broken.css");
    const pattern = route.url_pattern.exec(req.url)!;
    const ctx = R.context(null, R.NOOP_LOGGER);

    const [handlerResult] = await route.handler(req, pattern, ctx);
    assertEquals(isLeft(handlerResult), true);
    if (isLeft(handlerResult)) {
      assertEquals(handlerResult.left.status, 500);
    }
  }
});

// =============================================================================
// generateComponentAlias tests
// =============================================================================

Deno.test("generateComponentAlias generates alias from simple path", () => {
  assertEquals(B.generateComponentAlias("/dashboard"), "DashboardPage");
});

Deno.test("generateComponentAlias generates alias from nested path", () => {
  assertEquals(
    B.generateComponentAlias("/users/settings"),
    "UsersSettingsPage",
  );
});

Deno.test("generateComponentAlias handles dynamic segments", () => {
  assertEquals(B.generateComponentAlias("/users/:userid"), "UsersUseridPage");
});

Deno.test("generateComponentAlias returns IndexPage for root path", () => {
  assertEquals(B.generateComponentAlias("/"), "IndexPage");
});

// =============================================================================
// findExportNameByEquality tests
// =============================================================================

Deno.test("findExportNameByEquality finds matching export", () => {
  const target = () => {};
  const exports = { MyComponent: target, other: () => {} };
  const result = B.findExportNameByEquality(exports, target);
  assertEquals(isSome(result), true);
  if (isSome(result)) {
    assertEquals(result.value, "MyComponent");
  }
});

Deno.test("findExportNameByEquality returns None when not found", () => {
  const target = () => {};
  const exports = { other: () => {} };
  const result = B.findExportNameByEquality(exports, target);
  assertEquals(isNone(result), true);
});

// =============================================================================
// detectRouteConflicts tests
// =============================================================================

Deno.test("detectRouteConflicts returns empty array when no conflicts", () => {
  const serverRoutes = [
    B.server_route("/a.ts", R.route("GET", "/users", mock_handler())),
  ];
  const clientPages: B.ClientPageEntry[] = [
    {
      absolutePath: "/b.tsx",
      relativePath: "dashboard.tsx",
      pathname: "/dashboard",
      title: "Dashboard",
      componentAlias: "DashboardPage",
      componentExportName: "Page",
    },
  ];

  const conflicts = B.detectRouteConflicts(serverRoutes, clientPages);
  assertEquals(conflicts.length, 0);
});

Deno.test("detectRouteConflicts detects server/client conflict", () => {
  const serverRoutes = [
    B.server_route("/a.ts", R.route("GET", "/users", mock_handler())),
  ];
  const clientPages: B.ClientPageEntry[] = [
    {
      absolutePath: "/b.tsx",
      relativePath: "users.tsx",
      pathname: "/users",
      title: "Users",
      componentAlias: "UsersPage",
      componentExportName: "Page",
    },
  ];

  const conflicts = B.detectRouteConflicts(serverRoutes, clientPages);
  assertEquals(conflicts.length, 1);
  assertEquals(conflicts[0].path, "/users");
});

// =============================================================================
// check_conflicts tests
// =============================================================================

Deno.test("check_conflicts returns Right when no conflicts", () => {
  const handler = mock_handler();
  const routes = B.site_routes({
    server_routes: [
      B.server_route("/a.ts", R.route("GET", "/users", handler)),
      B.server_route("/b.ts", R.route("GET", "/posts", handler)),
    ],
    static_routes: [
      B.static_route("/c.txt", R.route("GET", "/file.txt", handler)),
    ],
    client_routes: [B.client_route("/d.tsx", R.route("GET", "/app", handler))],
  });

  const result = B.check_conflicts(routes);
  assertEquals(isRight(result), true);
});

Deno.test("check_conflicts detects conflict in server routes", () => {
  const handler = mock_handler();
  const routes = B.site_routes({
    server_routes: [
      B.server_route("/a.ts", R.route("GET", "/users", handler)),
      B.server_route("/b.ts", R.route("GET", "/users", handler)), // Conflict!
    ],
  });

  const result = B.check_conflicts(routes);
  assertEquals(isLeft(result), true);
  if (isLeft(result)) {
    assertEquals(result.left.name, "RouteConflictError");
  }
});

Deno.test("check_conflicts allows different methods on same path", () => {
  const handler = mock_handler();
  const routes = B.site_routes({
    server_routes: [
      B.server_route("/a.ts", R.route("GET", "/users", handler)),
      B.server_route("/b.ts", R.route("POST", "/users", handler)), // Different method, OK
    ],
  });

  const result = B.check_conflicts(routes);
  assertEquals(isRight(result), true);
});

// =============================================================================
// build_site integration tests (using real fixtures directory)
// =============================================================================

// =============================================================================
// Tests using real fixtures
// =============================================================================

// Get the fixtures directory path
const FIXTURES_DIR = new URL("./fixtures", import.meta.url).pathname;

Deno.test({
  name: "build_server_routes imports and processes server route file",
  fn: async () => {
    const serverRoutePath = `${FIXTURES_DIR}/server_route.ts`;
    const entry = B.file_entry(
      serverRoutePath,
      "server_route.ts",
      "server_route.ts",
      ".ts",
      O.none,
      async () => new ReadableStream(),
    );

    const config: B.SiteConfig = {
      root_path: FIXTURES_DIR,
      state: null,
      logger: R.NOOP_LOGGER,
      server_extensions: [".ts"],
    };

    const effect = B.build_server_routes(entry, config);
    const [result] = await effect();

    assertEquals(isRight(result), true);
    if (isRight(result)) {
      assertEquals(isSome(result.right), true);
      if (isSome(result.right)) {
        // Should have 2 server routes (get and post)
        assertEquals(result.right.value.server_routes.length, 2);
      }
    }
  },
});

Deno.test({
  name:
    "build_server_routes returns None for file with no PartialRoute exports",
  fn: async () => {
    const noExportsPath = `${FIXTURES_DIR}/no_exports.ts`;
    const entry = B.file_entry(
      noExportsPath,
      "no_exports.ts",
      "no_exports.ts",
      ".ts",
      O.none,
      async () => new ReadableStream(),
    );

    const config: B.SiteConfig = {
      root_path: FIXTURES_DIR,
      state: null,
      logger: R.NOOP_LOGGER,
      server_extensions: [".ts"],
    };

    const effect = B.build_server_routes(entry, config);
    const [result] = await effect();

    assertEquals(isRight(result), true);
    if (isRight(result)) {
      assertEquals(isNone(result.right), true);
    }
  },
});

Deno.test({
  name: "detectClientPage detects client page from TSX file",
  fn: async () => {
    const clientPagePath = `${FIXTURES_DIR}/client_root.tsx`;
    const entry = B.file_entry(
      clientPagePath,
      "client_root.tsx",
      "client_root.tsx",
      ".tsx",
      O.none,
      async () => new ReadableStream(),
    );

    const result = await B.detectClientPage(entry, [".ts", ".tsx"]);

    assertEquals(isRight(result), true);
    if (isRight(result)) {
      assertEquals(isSome(result.right), true);
      if (isSome(result.right)) {
        assertEquals(result.right.value.pathname, "/client_root");
        assertEquals(result.right.value.componentExportName, "Page");
      }
    }
  },
});

Deno.test({
  name: "detectClientPage returns None for file without client exports",
  fn: async () => {
    const noExportsPath = `${FIXTURES_DIR}/no_exports.ts`;
    const entry = B.file_entry(
      noExportsPath,
      "no_exports.ts",
      "no_exports.ts",
      ".ts",
      O.none,
      async () => new ReadableStream(),
    );

    const result = await B.detectClientPage(entry, [".ts", ".tsx"]);

    assertEquals(isRight(result), true);
    if (isRight(result)) {
      assertEquals(isNone(result.right), true);
    }
  },
});

Deno.test("from_site_routes sorts all route types by specificity", () => {
  const handler = mock_handler();

  // Create routes with various specificities
  const sr = B.site_routes({
    server_routes: [
      B.server_route("/a.ts", R.route("GET", "/api/:id/*", handler)), // 2 params
      B.server_route("/b.ts", R.route("GET", "/api/:id", handler)), // 1 param
      B.server_route("/c.ts", R.route("GET", "/api", handler)), // 0 params
    ],
    static_routes: [
      B.static_route("/d.txt", R.route("GET", "/static/:file", handler)), // 1 param
      B.static_route("/e.txt", R.route("GET", "/static", handler)), // 0 params
    ],
    client_routes: [
      B.client_route("/f.tsx", R.route("GET", "/app/*", handler)), // 1 param
      B.client_route("/g.tsx", R.route("GET", "/app", handler)), // 0 params
    ],
  });

  const routes = B.from_site_routes(sr);

  // Server routes come first, sorted by specificity (0, 1, 2 params)
  assertEquals(routes[0].pathname, "/api");
  assertEquals(routes[1].pathname, "/api/:id");
  assertEquals(routes[2].pathname, "/api/:id/*");

  // Then static routes
  assertEquals(routes[3].pathname, "/static");
  assertEquals(routes[4].pathname, "/static/:file");

  // Then client routes
  assertEquals(routes[5].pathname, "/app");
  assertEquals(routes[6].pathname, "/app/*");
});

// =============================================================================
// Tests for import failure paths
// =============================================================================

Deno.test("build_server_routes returns error when import fails", async () => {
  const badFilePath = `${FIXTURES_DIR}/bad_syntax.ts`;
  const entry = B.file_entry(
    badFilePath,
    "bad_syntax.ts",
    "bad_syntax.ts",
    ".ts",
    O.none,
    async () => new ReadableStream(),
  );

  const config: B.SiteConfig = {
    root_path: FIXTURES_DIR,
    state: null,
    logger: R.NOOP_LOGGER,
    server_extensions: [".ts"],
  };

  const effect = B.build_server_routes(entry, config);
  const [result] = await effect();

  // Import should fail due to syntax error
  assertEquals(isLeft(result), true);
  if (isLeft(result)) {
    assertEquals(result.left.name, "RouteBuildError");
  }
});

Deno.test("detectClientPage returns None when import fails", async () => {
  const badFilePath = `${FIXTURES_DIR}/bad_syntax.ts`;
  const entry = B.file_entry(
    badFilePath,
    "bad_syntax.ts",
    "bad_syntax.ts",
    ".ts",
    O.none,
    async () => new ReadableStream(),
  );

  const result = await B.detectClientPage(entry, [".ts"]);

  // Should return None (not error) when import fails
  assertEquals(isRight(result), true);
  if (isRight(result)) {
    assertEquals(isNone(result.right), true);
  }
});

Deno.test({
  name: "build_site processes server routes from fixtures directory",
  fn: async () => {
    const result = await B.build_site({
      root_path: FIXTURES_DIR,
      state: null,
      logger: R.NOOP_LOGGER,
      server_extensions: [".ts"],
    });

    assertEquals(isLeft(result), true);
  },
});
