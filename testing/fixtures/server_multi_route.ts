import * as Effect from "@baetheus/fun/effect";
import * as Tokens from "@baetheus/pick/tokens";
import * as Router from "@baetheus/pick/router";

export const getUsers = Tokens.get(
  Effect.right(Router.json(JSON.stringify({ users: [] }))),
);

export const createUser = Tokens.post(
  Effect.right(Router.json(JSON.stringify({ id: 1 }))),
);

export const deleteUser = Tokens.del(
  Effect.right(Router.text("Deleted")),
);
