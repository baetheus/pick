/**
 * Test fixture: A simple server route file for testing the builder.
 */
import * as E from "fun/effect";
import * as B from "@baetheus/pick/builder";
import * as R from "@baetheus/pick/router";

export const get = B.get(
  E.gets(() => R.text("Hello from server route!")),
);
