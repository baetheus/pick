/**
 * Home page route.
 *
 * Demonstrates a simple GET handler that returns HTML.
 */

import * as E from "fun/effect";

import * as B from "../../../builder.ts";
import * as R from "../../../router.ts";

type AppState = {
  readonly start_time: number;
  readonly request_count: { value: number };
};

export const get = B.get<AppState>(
  E.gets((_req, _params, ctx) => {
    const uptime = Math.floor((Date.now() - ctx.state.start_time) / 1000);

    return R.html(`
<!DOCTYPE html>
<html>
<head>
  <title>Pick Builder Example</title>
  <link rel="stylesheet" href="/public/style.css">
</head>
<body>
  <h1>Pick Builder Example</h1>
  <p>Server uptime: ${uptime} seconds</p>
  <p>Total requests: ${ctx.state.request_count.value}</p>

  <h2>Server Routes</h2>
  <ul>
    <li><a href="/">GET /</a> - This page</li>
    <li><a href="/api/users">GET /api/users</a> - List users</li>
    <li><a href="/api/users/1">GET /api/users/:id</a> - Get user by ID</li>
    <li><a href="/health">GET /health</a> - Health check</li>
  </ul>

  <h2>Client SPA</h2>
  <ul>
    <li><a href="/app/client">GET /app/client</a> - Preact SPA (bundled with esbuild)</li>
    <li><a href="/app/settings">GET /app/settings</a> - Settings page (client redirect)</li>
  </ul>

  <script src="/public/script.js"></script>
</body>
</html>
    `);
  }),
);
