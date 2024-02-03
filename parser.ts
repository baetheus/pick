import type { Option } from "fun/option";

import { fromNullable, map, none } from "fun/option";
import { pipe } from "fun/fn";

type Rec<Key extends string | symbol = string, Value = string> = {
  readonly [K in Key]: Value;
};

export type HttpVerbs =
  | "ACL"
  | "BIND"
  | "CHECKOUT"
  | "CONNECT"
  | "COPY"
  | "DELETE"
  | "GET"
  | "HEAD"
  | "LINK"
  | "LOCK"
  | "M-SEARCH"
  | "MERGE"
  | "MKACTIVITY"
  | "MKCALENDAR"
  | "MKCOL"
  | "MOVE"
  | "NOTIFY"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PROPFIND"
  | "PROPPATCH"
  | "PURGE"
  | "PUT"
  | "REBIND"
  | "REPORT"
  | "SEARCH"
  | "SOURCE"
  | "SUBSCRIBE"
  | "TRACE"
  | "UNBIND"
  | "UNLINK"
  | "UNLOCK"
  | "UNSUBSCRIBE";

export const Wildcards = Symbol("Wildcards");
export type Wildcards = typeof Wildcards;

export type PathVars<
  P extends string,
  // deno-lint-ignore ban-types
  R extends Record<string, string> = {},
> = P extends `${HttpVerbs} /${infer Part}` ? PathVars<Part>
  : P extends `:${infer Key}/${infer Part}` ? PathVars<Part, R & Rec<Key>>
  : P extends `*/${infer Part}`
    ? PathVars<Part, R & Rec<Wildcards, readonly string[]>>
  : P extends `${string}/${infer Part}` ? PathVars<Part, R>
  : P extends `:${infer Key}` ? PathVars<"", R & Rec<Key>>
  : P extends `*` ? PathVars<"", R & Rec<Wildcards, readonly string[]>>
  : { readonly [K in keyof R]: R[K] };

export type RouteString = `${HttpVerbs} /${string}`;

export type RouteParser<V> = (req: Request) => Option<V>;

export function routeParser<In extends RouteString>(
  route: In,
): RouteParser<PathVars<In>> {
  const [method, pathname] = route.split(" ");
  const pattern = new URLPattern({ pathname });

  return (req) => {
    const _method = req.method.toUpperCase();

    if (_method !== method) {
      return none;
    }
    return pipe(
      pattern.exec(req.url),
      fromNullable,
      map((result) => {
        const groups: { [K: string | symbol]: string | string[] | undefined } =
          { ...result.pathname.groups };
        if (0 in groups) {
          const wildcards: string[] = [];
          let index = -1;
          while (++index in groups) {
            wildcards.push(groups[index] as string);
          }
          groups[Wildcards] = wildcards;
        }
        return groups as PathVars<In>;
      }),
    );
  };
}
