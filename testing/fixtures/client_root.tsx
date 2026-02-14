/**
 * Test fixture: A client root file.
 */
import { client_root } from "../../builder.ts";

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
