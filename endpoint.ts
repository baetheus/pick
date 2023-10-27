import type { Schema } from "fun/schemable.ts";
import type { Handler } from "./handler.ts";
import type { RouteString } from "./parser.ts";

import * as H from "./handler.ts";

export type Endpoint<R extends RouteString, I, O> = {
  readonly route: R;
  readonly input: Schema<I>;
  readonly output: Schema<O>;
};

export function endpoint<R extends RouteString, I, O>(
  route: R,
  input: Schema<I>,
  output: Schema<O>,
): Endpoint<R, I, O> {
  return { route, input, output };
}
