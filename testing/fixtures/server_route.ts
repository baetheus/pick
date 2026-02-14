/**
 * Test fixture: A server route file with PartialRoute exports.
 */
import * as E from "fun/effect";
import * as B from "../../builder.ts";
import * as R from "../../router.ts";

export const get = B.get(
  E.gets(() => R.text("Hello from GET")),
);

export const post = B.post(
  E.gets(() => R.text("Hello from POST")),
);
