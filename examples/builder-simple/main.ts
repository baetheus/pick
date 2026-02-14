import { pipe } from "fun/fn";
import * as Either from "fun/either";

import * as B from "@baetheus/pick/builder";
import * as R from "@baetheus/pick/router";
import { deno_tools } from "@baetheus/pick/platforms/deno";
import { esbuild_deno_preact } from "@baetheus/pick/bundlers/esbuild-deno-preact";

// Logging middleware
const logging_middleware = R.middleware((handler) => {
  return async (req, pattern, ctx) => {
    const start = performance.now();
    ctx.logger.info(`--> ${req.method} ${new URL(req.url).pathname}`);

    const result = await handler(req, pattern, ctx);
    const [response] = result;
    const status = response.tag === "Right"
      ? response.right.status
      : response.left.status;

    const duration = (performance.now() - start).toFixed(2);
    ctx.logger.info(
      `<-- ${req.method} ${new URL(req.url).pathname} ${status} ${duration}ms`,
    );

    return result;
  };
});

// Build and serve the site
async function main() {
  const result = await B.build_site({
    root_path: new URL("./routes", import.meta.url).pathname,
    tools: deno_tools(),
    state: null,
    middlewares: [logging_middleware],
    server_extensions: [".ts"],
    bundler: esbuild_deno_preact({
      minify: true, // Disable minification for development
      sourcemap: "inline", // Include source maps for debugging
    }),
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
        console.log("\nServer Routes:");
        for (const route of site.site_routes.server_routes) {
          console.log(`  ${route.route.method} ${route.route.pathname}`);
        }
        console.log("\nStatic Routes:");
        for (const route of site.site_routes.static_routes) {
          console.log(`  ${route.route.method} ${route.route.pathname}`);
        }
        console.log("\nClient Routes:");
        for (const route of site.site_routes.client_routes) {
          console.log(`  ${route.route.method} ${route.route.pathname}`);
        }

        console.log("\nStarting server on http://localhost:8000");
        Deno.serve({ port: 8000 }, site.handle);
      },
    ),
  );
}

main();
