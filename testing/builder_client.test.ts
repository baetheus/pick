import { assertEquals } from "@std/assert";
import * as Either from "@baetheus/fun/either";
import * as Option from "@baetheus/fun/option";
import * as Path from "@std/path";

import * as Builder from "../builder.ts";
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

function unsafe_import(path: string): Promise<unknown> {
  return import(path);
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
    unsafe_import,
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
    unsafe_import,
    builders: [builder],
  };

  const result = await evaluateEffect(builder.process_file(fileEntry), config);

  // process_file always returns empty array; routes are created in process_build
  assertEquals(Either.isRight(result), true);
  if (Either.isRight(result)) {
    assertEquals(result.right.length, 0);
  }
});

// ============================================================================
// process_build validation tests
// ============================================================================

Deno.test("client_builder - full test", async () => {
  const result = await Builder.build({
    root_path: FIXTURES_DIR,
    fs: deno_fs,
    unsafe_import,
    builders: [client_builder()],
  });

  assertEquals(Either.isRight(result), true);
  assertEquals(
    (<Either.Right<Builder.SiteBuildResult>> result).right.site_routes.length,
    14,
  );
});
