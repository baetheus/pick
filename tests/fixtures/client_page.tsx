import * as Tokens from "@baetheus/pick/tokens";

function Page() {
  return <div>Another Page!</div>;
}

export const page = Tokens.client_route.create(Page);
