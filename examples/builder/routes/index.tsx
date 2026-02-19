import * as T from "@baetheus/pick/tokens";

export function Home() {
  console.log("From the frontend!");
  return <h1>Hello World</h1>;
}

export const home_route = T.client_default.create(Home);
