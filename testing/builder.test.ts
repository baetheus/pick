import { assertEquals, assertExists } from "@std/assert";
import * as Either from "@baetheus/fun/either";
import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import * as Option from "@baetheus/fun/option";
import * as Path from "@std/path";
import * as Refinement from "@baetheus/fun/refinement";

import * as Builder from "../builder.ts";
import * as Router from "../router.ts";
import * as Tokens from "../tokens.ts";

// ============================================================================
// Error Refinements
// ============================================================================

const isErr = Refinement.struct({
  tag: Refinement.string,
});

// ============================================================================
// In-Memory Mock Filesystem
// ============================================================================

type MockFile = {
  readonly content: Uint8Array;
  readonly mimeType: Option.Option<string>;
};

export function createMockFilesystem(
  files: Record<string, MockFile> = {},
): Builder.Filesystem {
  const storage = new Map<string, MockFile>(Object.entries(files));
  let tempCounter = 0;

  return {
    makeTempFile: async (options) => {
      const suffix = options?.suffix ?? "";
      const prefix = options?.prefix ?? "tmp";
      const dir = options?.dir ?? "/tmp";
      const filename = `${prefix}${tempCounter++}${suffix}`;
      const path = `${dir}/${filename}`;
      storage.set(path, { content: new Uint8Array(), mimeType: Option.none });
      return path;
    },

    walk: async (root) => {
      const entries: Builder.FileEntry[] = [];
      for (const [filePath, file] of storage.entries()) {
        if (filePath.startsWith(root)) {
          const parsed_path = Path.parse(filePath);
          const relative_path = filePath.slice(root.length);
          entries.push(
            Builder.file_entry(parsed_path, relative_path, file.mimeType),
          );
        }
      }
      return entries;
    },

    read: async (path) => {
      const filePath = Path.format(path);
      const file = storage.get(filePath);
      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          // Create a new Uint8Array with ArrayBuffer to satisfy type constraints
          const buffer = new ArrayBuffer(file.content.length);
          const arr = new Uint8Array(buffer);
          arr.set(file.content);
          controller.enqueue(arr);
          controller.close();
        },
      });
    },

    write: async (path, data) => {
      const filePath = Path.format(path);
      let content: Uint8Array;
      if (data instanceof Uint8Array) {
        content = data;
      } else {
        const reader = data.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        content = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          content.set(chunk, offset);
          offset += chunk.length;
        }
      }
      const existing = storage.get(filePath);
      storage.set(filePath, {
        content,
        mimeType: existing?.mimeType ?? Option.none,
      });
    },
  };
}

export function mockFile(
  content: string | Uint8Array,
  mimeType?: string,
): MockFile {
  return {
    content: typeof content === "string"
      ? new TextEncoder().encode(content)
      : content,
    mimeType: mimeType ? Option.some(mimeType) : Option.none,
  };
}

// ============================================================================
// file_entry tests
// ============================================================================

Deno.test("file_entry - creates FileEntry with leading slash", () => {
  const parsed = Path.parse("/root/dir/file.ts");
  const entry = Builder.file_entry(parsed, "dir/file.ts", Option.none);

  assertEquals(entry.relative_path, "/dir/file.ts");
  assertEquals(entry.absolute_path, "/root/dir/file.ts");
  assertEquals(entry.parsed_path, parsed);
  assertEquals(entry.mime_type, Option.none);
});

Deno.test("file_entry - preserves leading slash if present", () => {
  const parsed = Path.parse("/root/dir/file.ts");
  const entry = Builder.file_entry(parsed, "/dir/file.ts", Option.none);

  assertEquals(entry.relative_path, "/dir/file.ts");
});

Deno.test("file_entry - includes mime type when provided", () => {
  const parsed = Path.parse("/root/styles.css");
  const entry = Builder.file_entry(
    parsed,
    "/styles.css",
    Option.some("text/css"),
  );

  assertEquals(Option.isSome(entry.mime_type), true);
  if (Option.isSome(entry.mime_type)) {
    assertEquals(entry.mime_type.value, "text/css");
  }
});

// ============================================================================
// full_route tests
// ============================================================================

Deno.test("full_route - creates FullRoute with correct properties", () => {
  const parsed = Path.parse("/root/api/users.ts");
  const handler: Router.Handler = Effect.right(Router.text("OK"));
  const route = Router.route("GET", "/api/users", handler);

  const fullRoute = Builder.full_route("TestBuilder", parsed, route);

  assertEquals(fullRoute.builder, "TestBuilder");
  assertEquals(fullRoute.absolute_path, "/root/api/users.ts");
  assertEquals(fullRoute.parsed_path, parsed);
  assertEquals(fullRoute.route.method, "GET");
  assertEquals(fullRoute.route.pathname, "/api/users");
});

// ============================================================================
// from_partial_route tests
// ============================================================================

Deno.test("from_partial_route - converts PartialRoute to FullRoute", () => {
  const parsed = Path.parse("/root/api/hello.ts");
  const fileEntry = Builder.file_entry(
    parsed,
    "/api/hello",
    Option.none,
  );
  const handler: Router.Handler = Effect.right(Router.text("Hello"));
  const partialRoute = Tokens.partial_route("GET", handler);

  const fullRoute = Builder.from_partial_route(
    "ServerBuilder",
    fileEntry,
    partialRoute,
  );

  assertEquals(fullRoute.builder, "ServerBuilder");
  assertEquals(fullRoute.route.method, "GET");
  assertEquals(fullRoute.route.pathname, "/api/hello");
});

// ============================================================================
// wrap_handler tests
// ============================================================================

Deno.test("wrap_handler - applies middleware in order", async () => {
  const calls: string[] = [];

  const baseHandler: Router.Handler = Effect.gets(() => {
    calls.push("handler");
    return Router.text("OK");
  });

  const middleware1: Router.Middleware<unknown> = (next) =>
    Effect.gets(async (req, url, ctx) => {
      calls.push("middleware1-before");
      const [result] = await next(req, url, ctx);
      calls.push("middleware1-after");
      return Either.isRight(result) ? result.right : result.left;
    });

  const middleware2: Router.Middleware<unknown> = (next) =>
    Effect.gets(async (req, url, ctx) => {
      calls.push("middleware2-before");
      const [result] = await next(req, url, ctx);
      calls.push("middleware2-after");
      return Either.isRight(result) ? result.right : result.left;
    });

  const wrapped = Builder.wrap_handler(baseHandler, [middleware1, middleware2]);

  const req = new Request("http://localhost/test");
  const urlResult = { pathname: { groups: {} } } as URLPatternResult;
  const ctx = Router.context({});

  await wrapped(req, urlResult, ctx);

  assertEquals(calls, [
    "middleware2-before",
    "middleware1-before",
    "handler",
    "middleware1-after",
    "middleware2-after",
  ]);
});

Deno.test("wrap_handler - returns original handler with empty middleware", () => {
  const handler: Router.Handler = Effect.right(Router.text("OK"));
  const wrapped = Builder.wrap_handler(handler, []);

  assertEquals(wrapped, handler);
});

// ============================================================================
// wrap_partial_route tests
// ============================================================================

Deno.test("wrap_partial_route - wraps handler and preserves method", () => {
  const handler: Router.Handler = Effect.right(Router.text("OK"));
  const partialRoute = Tokens.partial_route("POST", handler);

  const middleware: Router.Middleware<unknown> = (next) =>
    Effect.gets(async (req, url, ctx) => {
      const [result] = await next(req, url, ctx);
      return Either.isRight(result) ? result.right : result.left;
    });

  const wrapped = Builder.wrap_partial_route(partialRoute, [middleware]);

  assertEquals(wrapped.method, "POST");
  // Handler should be different (wrapped)
  assertEquals(wrapped.handler !== handler, true);
});

// ============================================================================
// findExportNameByEquality tests
// ============================================================================

Deno.test("findExportNameByEquality - finds matching export", () => {
  const target = { id: 1 };
  const exports = {
    foo: { id: 2 },
    bar: target,
    baz: { id: 3 },
  };

  const result = Builder.findExportNameByEquality(exports, target);

  assertEquals(Option.isSome(result), true);
  if (Option.isSome(result)) {
    assertEquals(result.value, "bar");
  }
});

Deno.test("findExportNameByEquality - returns none when not found", () => {
  const target = { id: 1 };
  const exports = {
    foo: { id: 2 },
    bar: { id: 3 },
  };

  const result = Builder.findExportNameByEquality(exports, target);

  assertEquals(Option.isNone(result), true);
});

// ============================================================================
// build tests
// ============================================================================

Deno.test("build - returns error when no builders specified", async () => {
  const fs = createMockFilesystem();
  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    builders: [],
  };

  const result = await Builder.build(config);

  assertEquals(Either.isLeft(result), true);
  if (Either.isLeft(result)) {
    assertEquals(isErr(result.left), true);
  }
});

Deno.test("build - processes files with builder", async () => {
  const fs = createMockFilesystem({
    "/root/test.txt": mockFile("hello", "text/plain"),
  });

  const processedFiles: Builder.FileEntry[] = [];
  const testBuilder: Builder.Builder = {
    name: "TestBuilder",
    process_file: (entry) => {
      processedFiles.push(entry);
      return Effect.right([]);
    },
    process_build: (routes) => Effect.right(routes),
  };

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    builders: [testBuilder],
  };

  const result = await Builder.build(config);

  assertEquals(Either.isRight(result), true);
  assertEquals(processedFiles.length, 1);
  assertEquals(processedFiles[0].relative_path, "/test.txt");
});

Deno.test("build - aggregates routes from multiple builders", async () => {
  const fs = createMockFilesystem({
    "/root/file.ts": mockFile("export const x = 1"),
  });

  const handler: Router.Handler = Effect.right(Router.text("OK"));

  const builder1: Builder.Builder = {
    name: "Builder1",
    process_file: (entry) =>
      Effect.right([
        Builder.full_route(
          "Builder1",
          entry.parsed_path,
          Router.route("GET", "/route1", handler),
        ),
      ]),
    // process_build returns only NEW routes to add (empty = no new routes)
    process_build: (_routes) => Effect.right([]),
  };

  const builder2: Builder.Builder = {
    name: "Builder2",
    process_file: (entry) =>
      Effect.right([
        Builder.full_route(
          "Builder2",
          entry.parsed_path,
          Router.route("POST", "/route2", handler),
        ),
      ]),
    // process_build returns only NEW routes to add (empty = no new routes)
    process_build: (_routes) => Effect.right([]),
  };

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    builders: [builder1, builder2],
  };

  const result = await Builder.build(config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    // Each builder processes each file, so 1 file * 2 builders = 2 routes
    assertEquals(result.right.site_routes.length, 2);
    const builderNames = result.right.site_routes.map((r) => r.builder);
    assertEquals(builderNames.filter((n) => n === "Builder1").length, 1);
    assertEquals(builderNames.filter((n) => n === "Builder2").length, 1);
  }
});

Deno.test("build - process_build receives all routes", async () => {
  const fs = createMockFilesystem({
    "/root/file.ts": mockFile("export const x = 1"),
  });

  const handler: Router.Handler = Effect.right(Router.text("OK"));
  let receivedRoutes: Builder.SiteRoutes = [];

  const builder: Builder.Builder = {
    name: "TestBuilder",
    process_file: (entry) =>
      Effect.right([
        Builder.full_route(
          "TestBuilder",
          entry.parsed_path,
          Router.route("GET", "/test", handler),
        ),
      ]),
    process_build: (routes) => {
      receivedRoutes = routes;
      return Effect.right(routes);
    },
  };

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    builders: [builder],
  };

  await Builder.build(config);

  assertEquals(receivedRoutes.length, 1);
  assertEquals(receivedRoutes[0].route.pathname, "/test");
});

Deno.test("build - process_build can add additional routes", async () => {
  const fs = createMockFilesystem({
    "/root/file.ts": mockFile("export const x = 1"),
  });

  const handler: Router.Handler = Effect.right(Router.text("OK"));

  const builder: Builder.Builder = {
    name: "TestBuilder",
    process_file: (entry) =>
      Effect.right([
        Builder.full_route(
          "TestBuilder",
          entry.parsed_path,
          Router.route("GET", "/original", handler),
        ),
      ]),
    // process_build should only return NEW routes to add, not the input routes
    // The build function merges file routes with build routes automatically
    process_build: (_routes) =>
      Effect.right([
        Builder.full_route(
          "TestBuilder",
          Path.parse("/generated"),
          Router.route("GET", "/generated", handler),
        ),
      ]),
  };

  const config: Builder.BuildConfig = {
    root_path: "/root",
    fs,
    builders: [builder],
  };

  const result = await Builder.build(config);

  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.site_routes.length, 2);
    const pathnames = result.right.site_routes.map((r) => r.route.pathname);
    assertEquals(pathnames.includes("/original"), true);
    assertEquals(pathnames.includes("/generated"), true);
  }
});

// ============================================================================
// Mock Filesystem tests
// ============================================================================

Deno.test("mockFilesystem - walk returns all files under root", async () => {
  const fs = createMockFilesystem({
    "/root/a.txt": mockFile("a"),
    "/root/sub/b.txt": mockFile("b"),
    "/other/c.txt": mockFile("c"),
  });

  const entries = await fs.walk("/root");

  assertEquals(entries.length, 2);
  const paths = entries.map((e) => e.absolute_path);
  assertEquals(paths.includes("/root/a.txt"), true);
  assertEquals(paths.includes("/root/sub/b.txt"), true);
});

Deno.test("mockFilesystem - read returns file content", async () => {
  const fs = createMockFilesystem({
    "/root/test.txt": mockFile("hello world"),
  });

  const stream = await fs.read(Path.parse("/root/test.txt"));
  const reader = stream.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);

  assertEquals(text, "hello world");
});

Deno.test("mockFilesystem - write stores content", async () => {
  const fs = createMockFilesystem();

  const content = new TextEncoder().encode("new content");
  await fs.write(Path.parse("/new/file.txt"), content);

  const stream = await fs.read(Path.parse("/new/file.txt"));
  const reader = stream.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);

  assertEquals(text, "new content");
});

Deno.test("mockFilesystem - makeTempFile creates unique paths", async () => {
  const fs = createMockFilesystem();

  const path1 = await fs.makeTempFile({ suffix: ".ts" });
  const path2 = await fs.makeTempFile({ suffix: ".ts" });

  assertEquals(path1 !== path2, true);
  assertEquals(path1.endsWith(".ts"), true);
  assertEquals(path2.endsWith(".ts"), true);
});
