/**
 * Example site using the directory-based router builder.
 *
 * This demonstrates:
 * - Server routes with typed params via schemas
 * - Static file serving
 * - Middleware integration
 * - Custom state passed to handlers
 *
 * Run with: deno run --allow-net --allow-read main.ts
 */

import { pipe } from "fun/fn";
import * as Either from "fun/either";

import * as B from "../../builder.ts";
import * as R from "../../router.ts";
import { deno_tools } from "../../platforms/deno.ts";

// Application state shared across all routes
type AppState = {
  readonly start_time: number;
  readonly request_count: { value: number };
};

// Logging middleware
const logging_middleware = R.middleware<AppState>((handler) => {
  return async (req, pattern, ctx) => {
    const start = performance.now();
    ctx.state.request_count.value++;

    ctx.logger.info(`--> ${req.method} ${new URL(req.url).pathname}`);

    const result = await handler(req, pattern, ctx);
    const [response] = result;
    const status = response.tag === "Right"
      ? response.right.status
      : response.left.status;

    const duration = (performance.now() - start).toFixed(2);
    ctx.logger.info(`<-- ${req.method} ${new URL(req.url).pathname} ${status} ${duration}ms`);

    return result;
  };
});

// Build and serve the site
async function main() {
  const state: AppState = {
    start_time: Date.now(),
    request_count: { value: 0 },
  };

  const result = await B.build_site({
    root_path: new URL("./routes", import.meta.url).pathname,
    tools: deno_tools(),
    state,
    middlewares: [logging_middleware],
    server_extensions: [".ts"],
  });

  pipe(
    result,
    Either.match(
      (error) => {
        console.error("Failed to build site:", error);
        Deno.exit(1);
      },
      (site) => {
        console.log("Site built successfully!");
        console.log("Routes:");
        for (const route of site.site_routes.server_routes) {
          console.log(`  ${route.route.method} ${route.route.pathname}`);
        }
        for (const route of site.site_routes.static_routes) {
          console.log(`  ${route.route.method} ${route.route.pathname} (static)`);
        }

        console.log("\nStarting server on http://localhost:8000");
        Deno.serve({ port: 8000 }, site.handle);
      },
    ),
  );
}

main();
