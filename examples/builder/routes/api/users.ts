/**
 * Users API endpoint.
 *
 * Demonstrates GET and POST handlers on the same route.
 */

import * as E from "fun/effect";

import * as B from "../../../../builder.ts";
import * as R from "../../../../router.ts";

// Mock user data
const users = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
  { id: 3, name: "Charlie", email: "charlie@example.com" },
];

// GET /api/users - List all users
export const get = B.get(
  E.gets(() => R.json(JSON.stringify({ users }))),
);

// POST /api/users - Create a new user
export const post = B.post(
  E.getsEither(async (req: Request) => {
    try {
      const body = await req.json() as { name?: string; email?: string };

      if (!body.name || !body.email) {
        return {
          tag: "Left" as const,
          left: R.json(
            JSON.stringify({ error: "name and email are required" }),
            R.STATUS_CODE.BadRequest,
          ),
        };
      }

      const newUser = {
        id: users.length + 1,
        name: body.name,
        email: body.email,
      };
      users.push(newUser);

      return {
        tag: "Right" as const,
        right: R.json(JSON.stringify(newUser), R.STATUS_CODE.Created),
      };
    } catch {
      return {
        tag: "Left" as const,
        left: R.json(
          JSON.stringify({ error: "Invalid JSON body" }),
          R.STATUS_CODE.BadRequest,
        ),
      };
    }
  }),
);
