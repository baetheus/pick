/**
 * Tests for the builder module, particularly around client route detection.
 */
import { assertEquals, assertExists } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import * as esbuild from "esbuild";

import * as B from "@baetheus/pick/builder";
import { deno_tools } from "../builder.ts";
import { esbuild_deno_preact } from "../esbuild.ts";

// Get the directory containing this test file
const TEST_DIR = dirname(fromFileUrl(import.meta.url));
const FIXTURES_DIR = join(TEST_DIR, "fixtures");

// -----------------------------------------------------------------------------
// safe_import tests
// -----------------------------------------------------------------------------

Deno.test("safe_import imports a local TypeScript file by absolute path", async () => {
  const server_route_path = join(FIXTURES_DIR, "server_route.ts");

  const [result] = await B.safe_import(server_route_path);

  assertEquals(result.tag, "Right", `Expected Right but got Left: ${JSON.stringify(result)}`);
  if (result.tag === "Right") {
    assertExists(result.right.get, "Expected 'get' export to exist");
    assertEquals(B.is_partial_route(result.right.get), true, "Expected 'get' to be a PartialRoute");
  }
});

Deno.test("safe_import imports a local TSX file by absolute path", async () => {
  const client_root_path = join(FIXTURES_DIR, "client_root.tsx");

  const [result] = await B.safe_import(client_root_path);

  assertEquals(result.tag, "Right", `Expected Right but got Left: ${JSON.stringify(result)}`);
  if (result.tag === "Right") {
    assertExists(result.right.default, "Expected default export to exist");
    assertEquals(B.is_client_root(result.right.default), true, "Expected default to be a ClientRoot");
  }
});

// -----------------------------------------------------------------------------
// detect_client_entry tests
// -----------------------------------------------------------------------------

Deno.test("detect_client_entry detects a client root from TSX file", async () => {
  const client_root_path = join(FIXTURES_DIR, "client_root.tsx");
  const tools = deno_tools();

  const file_entry = B.file_entry(
    client_root_path,
    "client_root.tsx",
    "client_root.tsx",
    ".tsx",
    tools.mime_type(".tsx"),
    () => tools.read_stream(client_root_path),
  );

  const config: B.SiteConfig = {
    root_path: FIXTURES_DIR,
    tools,
    state: null,
  };

  const result = await B.detect_client_entry(file_entry, config);

  assertEquals(result.tag, "Right", `Expected Right but got Left: ${JSON.stringify(result)}`);
  if (result.tag === "Right") {
    assertEquals(result.right.tag, "Some", "Expected Some but got None - client root was not detected");
    if (result.right.tag === "Some") {
      assertEquals(result.right.value.type, "root", "Expected type to be 'root'");
      assertEquals(result.right.value.entry.pathname, "/client_root", "Expected pathname to be '/client_root'");
    }
  }
});

Deno.test("detect_client_entry returns None for server route files", async () => {
  const server_route_path = join(FIXTURES_DIR, "server_route.ts");
  const tools = deno_tools();

  const file_entry = B.file_entry(
    server_route_path,
    "server_route.ts",
    "server_route.ts",
    ".ts",
    tools.mime_type(".ts"),
    () => tools.read_stream(server_route_path),
  );

  const config: B.SiteConfig = {
    root_path: FIXTURES_DIR,
    tools,
    state: null,
  };

  const result = await B.detect_client_entry(file_entry, config);

  assertEquals(result.tag, "Right", `Expected Right but got Left: ${JSON.stringify(result)}`);
  if (result.tag === "Right") {
    // Server routes have PartialRoute exports, not ClientRoot default exports
    // So detect_client_entry should return None
    assertEquals(result.right.tag, "None", "Expected None for server route file");
  }
});

// -----------------------------------------------------------------------------
// build_site tests
// -----------------------------------------------------------------------------

Deno.test({
  name: "build_site creates client routes when bundler is configured",
  // esbuild spawns a subprocess that cannot be fully cleaned up in Deno
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tools = deno_tools();

    const result = await B.build_site({
      root_path: FIXTURES_DIR,
      tools,
      state: null,
      server_extensions: [".ts"],
      client_extensions: [".tsx"],
      bundler: esbuild_deno_preact({
        minify: false,
        sourcemap: false,
      }),
    });

    assertEquals(result.tag, "Right", `Expected Right but got Left: ${JSON.stringify(result)}`);
    if (result.tag === "Right") {
      const site = result.right;

      // Should have server routes from server_route.ts
      assertEquals(
        site.site_routes.server_routes.length > 0,
        true,
        "Expected at least one server route",
      );

      // Should have client routes from client_root.tsx
      assertEquals(
        site.site_routes.client_routes.length > 0,
        true,
        `Expected at least one client route, but got ${site.site_routes.client_routes.length}. ` +
          `This is the main bug - client roots are not being detected and bundled.`,
      );

      // Verify the client route paths
      const client_pathnames = site.site_routes.client_routes.map((r) => r.route.pathname);
      console.log("Client route pathnames:", client_pathnames);
    }

    // Stop esbuild subprocess - this needs to happen before test ends
    // but with sanitizeOps: false, the async completion won't cause test failures
    esbuild.stop();
  },
});

Deno.test({
  name: "build_site creates server routes from PartialRoute exports",
  // May be affected by esbuild cleanup from previous test
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tools = deno_tools();

    const result = await B.build_site({
      root_path: FIXTURES_DIR,
      tools,
      state: null,
      server_extensions: [".ts"],
      client_extensions: [".tsx"],
    });

    assertEquals(result.tag, "Right", `Expected Right but got Left: ${JSON.stringify(result)}`);
    if (result.tag === "Right") {
      const site = result.right;

      // Should have server routes from server_route.ts
      const server_pathnames = site.site_routes.server_routes.map((r) => r.route.pathname);
      console.log("Server route pathnames:", server_pathnames);

      assertEquals(
        server_pathnames.includes("/server_route"),
        true,
        `Expected server route at '/server_route', got: ${server_pathnames}`,
      );
    }
  },
});
