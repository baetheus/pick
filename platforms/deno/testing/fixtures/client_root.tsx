/**
 * Test fixture: A simple client root file for testing the builder.
 */
import { client_root } from "@baetheus/pick/builder";

export default client_root(({ scripts, styles, baseUrl }) => `
<!DOCTYPE html>
<html>
<head>
  <base href="${baseUrl}">
  ${styles.map((s) => `<link rel="stylesheet" href="${s}">`).join("\n  ")}
</head>
<body>
  <div id="app"></div>
  ${scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n  ")}
</body>
</html>
`);

// Client-side render code (only runs in browser)
if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) {
    root.textContent = "Hello from client root!";
  }
}
