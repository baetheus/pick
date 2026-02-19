import * as T from "@baetheus/pick/tokens";

export function Home() {
  console.log("Hello in the frontend");
  return (
    <>
      <h1>Hello World</h1>
      <ul>
        <li>
          <a href="/">Home</a>
        </li>
        <li>
          <a href="/test">Test</a>
        </li>
      </ul>
    </>
  );
}

export const home_route = T.client_default.create(Home);
