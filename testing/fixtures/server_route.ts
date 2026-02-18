/**
 * Test fixture: A server route file with PartialRoute exports.
 */
import * as E from "fun/effect";
import * as R from "../../router.ts";
import * as T from "../../tokens.ts";

export const get = T.get(
  E.gets(() => R.text("Hello from GET")),
);

export const post = T.post(
  E.gets(() => R.text("Hello from POST")),
);
