/**
 * This example is a work in progress. As I refine the builder portion of the
 * pick library this example should get simpler. The basic idea of a Site is
 * that you point it at a directory, give it a few Builders, which turn files in
 * the directory into StaticRoutes, ClientRoutes, or ServerRoutes, and end up
 * with an api, a spa, and static assets colocated in as sensible a fashion as
 * you see fit.
 *
 * My goal is to keep the actual SiteBuilder and Builder types generic enough
 * that they can be run on any platform (ie. Deno, Bun, or Nodejs).
 */
import * as E from "fun/either";
import { identity, pipe } from "fun/fn";
import { extname, join, relative } from "@std/path";
import { walk } from "@std/fs";
import { pino } from "npm:pino";

import * as B from "../builder.ts";
import * as R from "../router.ts";
import { nanoid } from "../utilities.ts";

const logger = pino(pino.destination(1));
const extract: (ea: E.Either<Response, Response>) => Response = E.match(
  identity,
  identity,
);
const middleware_logger = R.middleware((h) => async (req, p, c) => {
  const id = nanoid();
  const { method, url } = req;
  c.logger.info({ id, method, url });
  const result = await h(req, p, c);
  const [eres] = result;
  const { status, statusText } = extract(eres);
  c.logger.info({ id, status, statusText });
  return result;
});

const site = await B.site_builder({
  root_path: join(import.meta.dirname ?? "/", "/routes"),
  middlewares: [middleware_logger],
  builders: [
    B.server_builder(),
    B.client_builder("index.html"),
    B.static_builder(),
  ],
  tools: {
    logger,
    read: async (r) => (await Deno.open(r, { read: true })).readable,
    extname,
    relative,
    walk,
  },
  state: null,
});

pipe(
  site,
  E.match(
    console.error,
    ({ handle }) => Deno.serve(handle),
  ),
);
