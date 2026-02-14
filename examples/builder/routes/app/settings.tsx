/**
 * Client redirect example.
 *
 * This route serves the same HTML as the client root,
 * allowing client-side routing to handle the /app/settings path.
 */

import { client_redirect } from "../../../../builder.ts";
import clientRoot from "./client.tsx";

export default client_redirect(clientRoot);
