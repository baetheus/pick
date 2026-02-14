/**
 * Test fixture: A client redirect file.
 */
import { client_redirect, client_root } from "../../builder.ts";

// Define the target client root inline for the redirect
const target = client_root(() => "<html>redirect target</html>");

export default client_redirect(target);

// Also export the target so tests can reference it
export { target };
