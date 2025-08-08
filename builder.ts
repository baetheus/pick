import type { Effect } from "fun/effect";
import type { Initializable } from "fun/initializable";

import type { Handler, Logger, Methods, Route, RouteString } from "./router.ts";

import * as M from "@std/media-types";
import * as E from "fun/effect";
import * as I from "fun/initializable";
import { getInitializableArray } from "fun/array";
import { none, type Option, some } from "fun/option";
import { type Either, right } from "fun/either";

import * as R from "./router.ts";

export type TaggedRoute<T extends string, D = unknown> = {
  readonly tag: T;
  readonly absolute_path: string;
  readonly route: Route<D>;
};

export type StaticRoute = TaggedRoute<"StaticRoute">;

export type ClientRoute = TaggedRoute<"ClientRoute">;

export type ServerRoute<D> = TaggedRoute<"ServerRoute", D>;

export type SiteRoute<D> = StaticRoute | ClientRoute | ServerRoute<D>;

export function static_route(
  absolute_path: string,
  route: Route,
): StaticRoute {
  return { tag: "StaticRoute", absolute_path, route };
}

export function client_route(
  absolute_path: string,
  route: Route,
): ClientRoute {
  return { tag: "ClientRoute", absolute_path, route };
}

export function server_route<D = unknown>(
  absolute_path: string,
  route: Route<D>,
): ServerRoute<D> {
  return { tag: "ServerRoute", absolute_path, route };
}

const PartialRouteSymbol = Symbol("pick/partial_route");

type PartialRouteSymbol = typeof PartialRouteSymbol;

export type PartialRoute<D> = {
  readonly type: PartialRouteSymbol;
  method: Methods;
  handler: Handler<D>;
};

export function handler<D = unknown>(
  method: Methods,
  handler: Handler<D>,
): PartialRoute<D> {
  return { type: PartialRouteSymbol, method, handler };
}

export function get<D = unknown>(
  route_handler: Handler<D>,
): PartialRoute<D> {
  return handler("GET", route_handler);
}

export function post<D = unknown>(
  route_handler: Handler<D>,
): PartialRoute<D> {
  return handler("GET", route_handler);
}

export function fromPartialRoute<D = unknown>(
  pathname: string,
  partial_route: PartialRoute<D>,
): Route<D> {
  return R.route(
    `${partial_route.method}, ${pathname}` as RouteString,
    partial_route.handler,
  );
}

export function isPartialRoute<D>(route: unknown): route is PartialRoute<D> {
  return typeof route !== "object" && Object.hasOwn(route!, "type") &&
    (route as { type: unknown }).type === PartialRouteSymbol;
}

export type WalkEntry = {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
  readonly name: string;
  readonly path: string;
};

export type FileEntry = {
  readonly name: string;
  readonly path: string;
};

export type BuilderTools = {
  readonly logger: R.Logger;
  readonly walk: (path: string) => AsyncIterable<WalkEntry>;
  readonly extname: (path: string) => string;
  readonly read: (
    path: string,
  ) => Promise<ReadableStream<Uint8Array<ArrayBuffer>>>;
  readonly relative: (from: string, to: string) => string;
};

export type SiteConfig<D> = {
  readonly root_path: string;
  readonly builders: RouteBuilder<D>[];
  readonly middlewares: R.Middleware<D>[];
  readonly tools: BuilderTools;
  readonly state: D;
};

export type RouteBuildError = {
  readonly type: "RouteBuildError";
  readonly message: string;
  readonly context: unknown;
};

export type SiteRoutes<D = unknown> = {
  readonly static_routes: readonly StaticRoute[];
  readonly client_routes: readonly ClientRoute[];
  readonly server_routes: readonly ServerRoute<D>[];
};

export function site_routes<D = unknown>(
  { static_routes = [], client_routes = [], server_routes = [] }: Partial<
    SiteRoutes<D>
  > = {},
): SiteRoutes<D> {
  return { static_routes, client_routes, server_routes };
}

export function from_site_routes<D>(
  { static_routes, client_routes, server_routes }: SiteRoutes<D>,
): Route<D>[] {
  return [
    ...server_routes.map((r) => r.route),
    ...static_routes.map((r) => r.route),
    ...client_routes.map((r) => r.route),
  ];
}

export function getIntializableSiteRoutes<D>(): Initializable<SiteRoutes<D>> {
  return I.struct({
    static_routes: getInitializableArray(),
    client_routes: getInitializableArray(),
    server_routes: getInitializableArray(),
  });
}

export function route_build_error(
  message: string,
  context: unknown = null,
): RouteBuildError {
  return { type: "RouteBuildError", message, context };
}

export type RouteBuilder<D = unknown> = Effect<
  [FileEntry, SiteConfig<D>, SiteRoutes<D>],
  RouteBuildError,
  Option<SiteRoutes<D>>
>;

export const static_builder: RouteBuilder = E.gets(
  ({ path, name }, { tools: { read, relative }, root_path }) => {
    const relative_path = relative(root_path, path);
    const route = static_route(
      path,
      R.route(
        R.route_string("GET", relative_path),
        E.tryCatch(
          async () => new Response(await read(path)),
          () =>
            R.text(
              `Unable to read file ${name}.`,
              R.STATUS_CODE.InternalServerError,
            ),
        ),
      ),
    );
    return some(site_routes({ static_routes: [route] }));
  },
);

export type SiteBuilder<D = unknown> = R.Router & {
  readonly site_config: SiteConfig<D>;
  readonly site_routes: SiteRoutes<D>;
};

export async function site_builder<D>(
  config: SiteConfig<D>,
): Promise<Either<RouteBuildError, SiteBuilder<D>>> {
  const { root_path, tools: { walk } } = config;
  const { combine } = getIntializableSiteRoutes<D>();
  let routes = site_routes<D>();

  // Run builders
  const entries = walk(root_path);
  for await (const entry of entries) {
    config.tools.logger.info("Found entry", entry);
    if (entry.isFile) {
      for (const builder of config.builders) {
        const [result] = await builder(entry, config, routes);
        if (result.tag === "Left") {
          return result;
        }
        if (result.right.tag === "Some") {
          routes = combine(routes)(result.right.value);
        }
      }
    }
  }

  const { handle } = R.router(R.context(config.state, config.tools.logger), {
    routes: from_site_routes(routes),
    middlewares: config.middlewares,
  });

  return right({ site_config: config, site_routes: routes, handle });
}

// export function route_builder<D = unknown>(
//   build: (
//     entry: WalkEntry,
//     root_path: string,
//   ) => SiteRoute<D> | Promise<SiteRoute<D>>,
//   exts: string[] = [],
//   skip: string[] = [],
// ): RouteBuilder<D> {
//   return { exts, skip, build };
// }

// export const StaticBuilder = route_builder((e, r) =>
//   static_route(
//     e.path,
//     R.route(
//       R.route_string("GET", relative(r, e.path)),
//       E.gets(async () => {
//         const file = await Deno.open(e.path, { read: true });
//         return new Response(file.readable);
//       }),
//     ),
//   )
// );

// export function client_builder(index_file: string): RouteBuilder {
//   return route_builder((e, r) =>
//     client_route(
//       e.path,
//       R.route(
//         R.route_string("GET", relative(r, e.path)),
//         E.gets(async () => {
//           const file = await Deno.open(index_file, { read: true });
//           return new Response(file.readable);
//         }),
//       ),
//     )
//   );
// }
