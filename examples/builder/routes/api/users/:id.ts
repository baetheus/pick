/**
 * Single user API endpoint with parameterized route.
 *
 * Demonstrates schema-validated path parameters.
 * The :id directory name becomes the :id path parameter.
 */

import * as E from "fun/effect";
import { schema } from "fun/schemable";

import * as B from "../../../../../builder.ts";
import * as R from "../../../../../router.ts";

// Mock user data (shared with parent route in real app)
const users = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
  { id: 3, name: "Charlie", email: "charlie@example.com" },
];

// Schema for path params - validates that id is present
const UserParams = schema((s) => s.struct({
  id: s.string(),
}));

// GET /api/users/:id - Get user by ID (with schema validation)
export const get = B.get({
  params: UserParams,
  handler: E.gets((_req: Request, params: URLPatternResult) => {
    const userId = parseInt(params.pathname.groups.id ?? "0", 10);
    const user = users.find((u) => u.id === userId);

    if (!user) {
      return R.json(
        JSON.stringify({ error: "User not found" }),
        R.STATUS_CODE.NotFound,
      );
    }

    return R.json(JSON.stringify(user));
  }),
});

// DELETE /api/users/:id - Delete user by ID
export const delete_ = B.delete_({
  params: UserParams,
  handler: E.gets((_req: Request, params: URLPatternResult) => {
    const userId = parseInt(params.pathname.groups.id ?? "0", 10);
    const index = users.findIndex((u) => u.id === userId);

    if (index === -1) {
      return R.json(
        JSON.stringify({ error: "User not found" }),
        R.STATUS_CODE.NotFound,
      );
    }

    const deleted = users.splice(index, 1)[0];
    return R.json(JSON.stringify({ deleted }));
  }),
});
