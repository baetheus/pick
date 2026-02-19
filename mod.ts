/**
 * Main entry point for the pick router builder.
 *
 * This module exports a convenient build function that configures all standard
 * builders (client, server, static) with sensible defaults for Deno applications.
 *
 * @module
 * @since 0.1.0
 */

import type { AnyErr } from "@baetheus/fun/err";
import type { Either } from "@baetheus/fun/either";
import * as Builder from "./builder.ts";
import * as DenoFS from "./deno_fs.ts";
import * as BuilderClient from "./builder_client.ts";
import * as BuilderServer from "./builder_server.ts";
import * as BuilderStatic from "./builder_static.ts";

/**
 * Builds a site from a directory using the default Deno filesystem and
 * standard builders (client, server, and static).
 *
 * This is a convenience function that sets up the builder with sensible
 * defaults. For more control, use the `build` function from `./builder.ts`
 * directly.
 *
 * @param root_path - The root directory to scan for routes and assets
 * @param site_name - The title to use for the generated site
 * @param unsafe_import - Function to dynamically import modules (typically `(p) => import(p)`)
 * @returns A Promise resolving to either an error or the build result
 *
 * @example
 * ```ts
 * import build from "@baetheus/pick";
 * import { router, context } from "@baetheus/pick/router";
 * import * as Either from "@baetheus/fun/either";
 *
 * const result = await build(
 *   "./src/routes",
 *   "My Application",
 *   (path) => import(path)
 * );
 *
 * if (Either.isRight(result)) {
 *   const routes = result.right.site_routes.map(r => r.route);
 *   const ctx = context({});
 *   const app = router(ctx, { routes });
 *   Deno.serve(app.handle);
 * }
 * ```
 *
 * @since 0.1.0
 */
export default function build(
  root_path: string,
  site_name: string,
  unsafe_import: (path: string) => Promise<unknown>,
): Promise<Either<AnyErr, Builder.SiteBuildResult>> {
  return Builder.build({
    root_path,
    fs: DenoFS.deno_fs,
    unsafe_import,
    builders: [
      BuilderClient.client_builder({ title: site_name }),
      BuilderServer.server_builder({}),
      BuilderStatic.static_builder({ exclude_extensions: [".ts", ".tsx"] }),
    ],
  });
}
