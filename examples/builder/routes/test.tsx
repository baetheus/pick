import * as T from "@baetheus/pick/tokens";

export function TestPage() {
  return <h1>This is a test page</h1>;
}

export const test_route = T.client_route.create(TestPage);
