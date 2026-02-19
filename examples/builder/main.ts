import { pipe } from "@baetheus/fun/fn";
import * as Either from "@baetheus/fun/either";

import build from "@baetheus/pick";
import * as R from "@baetheus/pick/router";

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
  pipe(
    await build(
      new URL("./routes", import.meta.url).pathname,
      "Sample Site",
      (path) => import(path),
    ),
    Either.match(
      (error) => {
        console.error("Failed to build site:", error);
        Deno.exit(1);
      },
      (site) => {
        console.log("Site built successfully!");
        for (const route of site.site_routes) {
          const url = route.route.url_pattern;
          console.log({
            ...route,
            url: `${url.protocol}${url.hostname}${url.pathname}`,
          });
        }

        console.log("\nStarting server on http://localhost:8000");

        const router = R.router(R.context(null), {
          routes: site.site_routes.map((r) => r.route),
          middlewares: [logging_middleware],
        });
        Deno.serve({ port: 8000 }, router.handle);
      },
    ),
  );
}

await main();
