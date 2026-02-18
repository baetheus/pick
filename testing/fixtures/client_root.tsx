/**
 * Test fixture: A client page file.
 */
import { client_page } from "../../tokens.ts";

export function Page() {
  return (
    <div>
      <h1>Client Page</h1>
      <p>This is a test client page.</p>
    </div>
  );
}

export default client_page("Test Client Page", Page);
