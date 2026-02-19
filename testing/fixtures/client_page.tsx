import * as Tokens from "@baetheus/pick/tokens";

function HomePage() {
  return <div>Home Page</div>;
}

export const home = Tokens.client_route.create(HomePage);
