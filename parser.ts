import type { Option } from "fun/option.ts";

import { none, some } from "fun/option.ts";

type HttpVerbs =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE"
  | "PATCH";

type Rec<Key extends string = string> = { readonly [K in Key]: string };

export type PathVars<
  P extends string,
  // deno-lint-ignore ban-types
  R extends Record<string, string> = {},
> = P extends `${HttpVerbs} /${infer Part}` ? PathVars<Part>
  : P extends `:${infer Key}/${infer Part}` ? PathVars<Part, R & Rec<Key>>
  : P extends `${infer _}/${infer Part}` ? PathVars<Part, R>
  : P extends `:${infer Key}` ? PathVars<"", R & Rec<Key>>
  : { readonly [K in keyof R]: string };

export type RouteString = `${HttpVerbs} /${string}`;

export type RouteParser<V> = (req: Request) => Option<V>;

export function routeParser<In extends RouteString>(
  route: In,
): RouteParser<PathVars<In>> {
  const [verb, rest] = route.split(" ");
  const words = rest.split("/");

  return (req) => {
    const v = req.method.toUpperCase();
    const url = new URL(req.url);
    const path = url.pathname.split("/");

    if (verb !== v) {
      return none;
    } else if (words.length !== path.length) {
      return none;
    } else {
      const vars: Record<string, string> = {};

      for (let i = 0; i < words.length; i++) {
        const left = words[i];
        const right = path[i];

        // Set variable in vars record
        if (left.startsWith(":")) {
          vars[left.slice(1)] = right;
          continue;
        }

        // Bail early if not a variable and route doesn't match
        if (left.toUpperCase() !== right.toUpperCase()) {
          return none;
        }
      }

      return some(vars as PathVars<In>);
    }
  };
}
