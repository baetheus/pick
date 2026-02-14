import { render } from "preact";
import { client_root } from "../../../builder.ts";

/**
 * Client root definition.
 *
 * The createIndex function receives the bundled script and style paths
 * and returns the HTML for the SPA shell.
 */
export default client_root(({ scripts, styles, baseUrl }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pick SPA Example</title>
  <base href="${baseUrl}">
  ${styles.map((s) => `<link rel="stylesheet" href="${s}">`).join("\n  ")}
  <style>
    body {
      margin: 0;
      padding: 0;
      min-height: 100vh;
    }
    #app {
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <div id="app">
    <p style="padding: 1rem;">Loading...</p>
  </div>
  ${
  scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n  ")
}
</body>
</html>
`);

/**
 * Client-side render code.
 *
 * This code only runs in the browser (not during bundling on the server).
 */
if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) {
    render(<h1>Hello World</h1>, root);
  }
}
