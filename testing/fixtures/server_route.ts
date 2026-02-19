import * as Effect from "@baetheus/fun/effect";
import * as Tokens from "@baetheus/pick/tokens";
import * as Router from "@baetheus/pick/router";

export const hello = Tokens.get(
  Effect.gets(() => Router.text("Hello from server route")),
);
