import * as Array from "fun/array";
import * as Effect from "fun/effect";
import * as Either from "fun/either";
import * as Err from "fun/err";
import * as Initializable from "fun/initializable";
import * as Option from "fun/option";
import * as Record from "fun/record";
import * as Refinement from "fun/refinement";
import { flow, pipe } from "fun/fn";

import * as Router from "./router.ts";

export type TaggedRoute<T extends string, D = unknown> = {
  readonly tag: T;
  readonly builder: string;
  readonly absolute_path: string;
  readonly route: Router.Route<D>;
};

export function tagged_route<T extends string, D = unknown>(
  tag: T,
  absolute_path: string,
  route: Router.Route<D>,
  builder: string,
): TaggedRoute<T, D> {
  return { tag, route, absolute_path, builder };
}

export type StaticRoute = TaggedRoute<"StaticRoute">;

export type ClientRoute = TaggedRoute<"ClientRoute">;

export type ServerRoute<D> = TaggedRoute<"ServerRoute", D>;

export type SiteRoute<D> = StaticRoute | ClientRoute | ServerRoute<D>;

export function static_route(
  absolute_path: string,
  route: Router.Route,
  builder: string = "unknown",
): StaticRoute {
  return tagged_route("StaticRoute", absolute_path, route, builder);
}

export function client_route(
  absolute_path: string,
  route: Router.Route,
  builder: string = "unknown",
): ClientRoute {
  return tagged_route("ClientRoute", absolute_path, route, builder);
}

export function server_route<D = unknown>(
  absolute_path: string,
  route: Router.Route<D>,
  builder: string = "unknown",
): ServerRoute<D> {
  return tagged_route("ServerRoute", absolute_path, route, builder);
}

const PartialRouteSymbol = Symbol("pick/partial_route");

type PartialRouteSymbol = typeof PartialRouteSymbol;

export type PartialRoute<D> = {
  readonly type: PartialRouteSymbol;
  method: Router.Methods;
  handler: Router.Handler<D>;
};

export function handler<D = unknown>(
  method: Router.Methods,
  handler: Router.Handler<D>,
): PartialRoute<D> {
  return { type: PartialRouteSymbol, method, handler };
}

export function get<D = unknown>(
  route_handler: Router.Handler<D>,
): PartialRoute<D> {
  return handler("GET", route_handler);
}

export function post<D = unknown>(
  route_handler: Router.Handler<D>,
): PartialRoute<D> {
  return handler("POST", route_handler);
}

export function from_partial_route<D = unknown>(
  pathname: string,
  partial_route: PartialRoute<D>,
): Router.Route<D> {
  return Router.route(
    partial_route.method,
    `/${pathname}`,
    partial_route.handler,
  );
}

export function is_partial_route<D>(route: unknown): route is PartialRoute<D> {
  return Refinement.isRecord(route) && Object.hasOwn(route, "type") &&
    route.type === PartialRouteSymbol;
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
  readonly logger: Router.Logger;
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
  readonly middlewares: Router.Middleware<D>[];
  readonly tools: BuilderTools;
  readonly state: D;
};

export const route_build_error = Err.err("RouteBuildError");

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
): Router.Route<D>[] {
  return [
    ...server_routes.map((r) => r.route),
    ...static_routes.map((r) => r.route),
    ...client_routes.map((r) => r.route),
  ];
}

export function getIntializableSiteRoutes<D>(): Initializable.Initializable<
  SiteRoutes<D>
> {
  return Initializable.struct({
    static_routes: Array.getInitializableArray(),
    client_routes: Array.getInitializableArray(),
    server_routes: Array.getInitializableArray(),
  });
}

export type RouteBuilder<D = unknown> = Effect.Effect<
  [FileEntry, SiteConfig<D>, SiteRoutes<D>],
  Err.AnyErr,
  Option.Option<SiteRoutes<D>>
>;

export type RouteBuilderResult<D> = Either.Either<
  Err.AnyErr,
  Option.Option<SiteRoutes<D>>
>;

export type SiteBuilder<D = unknown> = Router.Router & {
  readonly site_config: SiteConfig<D>;
  readonly site_routes: SiteRoutes<D>;
};

export async function site_builder<D>(
  config: SiteConfig<D>,
): Promise<Either.Either<Err.AnyErr, SiteBuilder<D>>> {
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

  const { handle } = Router.router(
    Router.context(config.state, config.tools.logger),
    {
      routes: from_site_routes(routes),
      middlewares: config.middlewares,
    },
  );

  return Either.right({ site_config: config, site_routes: routes, handle });
}

export const safe_import = Effect.tryCatch(
  async (path: string): Promise<Record<string, unknown>> => {
    const result = await import(path);
    if (Refinement.isRecord(result)) {
      return result;
    }
    throw new Error("Import did not return a record type.");
  },
  (error, [path]) =>
    route_build_error("Unable to import file.", { error, path }),
);

export function static_route_builder<D>(): RouteBuilder<D> {
  return Effect.gets(
    ({ path, name }, { tools: { read, relative }, root_path }) => {
      const relative_path = relative(root_path, path);
      const route = static_route(
        path,
        Router.route(
          "GET",
          relative_path,
          Effect.tryCatch(
            async () => new Response(await read(path)),
            () =>
              Router.text(
                `Unable to read file ${name}.`,
                Router.STATUS_CODE.InternalServerError,
              ),
          ),
        ),
        "static_builder",
      );
      return Option.some(site_routes({ static_routes: [route] }));
    },
  );
}

export function server_route_builder<D>(): RouteBuilder<D> {
  return Effect.getsEither(
    async (entry, config) => {
      const { name, path } = entry;
      const { root_path } = config;
      const { extname, relative } = config.tools;

      if (extname(name) !== ".ts") {
        return Either.right(Option.none);
      }

      const relative_path = relative(
        root_path,
        path.substring(0, path.length - 3),
      );

      return pipe(
        await safe_import(path),
        ([imports]) => imports,
        Either.map(flow(
          Record.entries,
          Array.map(([_, pr]) => pr),
          Array.filter(is_partial_route<D>),
          Array.map((pr) =>
            server_route(
              path,
              from_partial_route(relative_path, pr),
              "server_builder",
            )
          ),
          (server_routes) => {
            if (server_routes.length > 0) {
              return Option.some(site_routes({ server_routes }));
            }
            return Option.none;
          },
        )),
      );
    },
  );
}

export function client_route_builder<D>(index_file: string): RouteBuilder<D> {
  return Effect.gets((e, r) =>
    Option.some(site_routes({
      client_routes: [client_route(
        e.path,
        Router.route(
          "GET",
          r.tools.relative(r.root_path, e.path),
          Effect.gets(async () => {
            const file = await Deno.open(index_file, { read: true });
            return new Response(file.readable);
          }),
        ),
        "client_builder",
      )],
    }))
  );
}
/**
 * Note here:
 *
 * Builder Should have two phases
 * 1. Read from route directory into FileEntry iterator
 * 2. Run each FileEntry through all builders and combine tagged routes
 * 3. Run the ClientRoutes through
 * 3. Sort tagged routes by specificity and construct a Router
 */
