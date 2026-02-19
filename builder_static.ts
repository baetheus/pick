import * as Option from "@baetheus/fun/option";
import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import { pipe } from "@baetheus/fun/fn";

import * as Builder from "./builder.ts";
import * as Router from "./router.ts";

const static_builder_error = Err.err("StaticBuilderError");

/**
 * Configuration options for the static file builder.
 *
 * @example
 * ```ts
 * import type { StaticBuilderOptions } from "@baetheus/pick/builder_static";
 *
 * const options: StaticBuilderOptions = {
 *   name: "MyStaticBuilder",
 *   middleware: [],
 *   exclude_extensions: [".ts", ".tsx"],
 * };
 * ```
 *
 * @since 0.1.0
 */
export type StaticBuilderOptions = {
  readonly name: string;
  readonly middleware: Router.Middleware<unknown>[];
  readonly exclude_extensions: string[];
  // Probably could add some cache headers here.
};

/**
 * Builds static routes from a file entry.
 *
 * Creates routes that serve static files (images, CSS, etc.) directly from
 * the filesystem. Automatically sets Content-Type headers based on file extension.
 *
 * @example
 * ```ts
 * import { static_builder } from "@baetheus/pick/builder_static";
 *
 * const builder = static_builder({
 *   name: "AssetsBuilder",
 *   exclude_extensions: [".ts", ".tsx"],
 * });
 * ```
 *
 * @since 0.1.0
 */
export function static_builder(
  {
    name = "DefaultStaticBuilder",
    middleware = [],
    exclude_extensions = [],
  }: Partial<StaticBuilderOptions> = {},
): Builder.Builder {
  return {
    name,
    process_build: () => Effect.right([]),
    process_file: (file_entry) => {
      // Bail on excluded extensions
      if (exclude_extensions.includes(file_entry.parsed_path.ext)) {
        return Effect.right([]);
      }

      // Cache headers
      const headers: HeadersInit = pipe(
        file_entry.mime_type,
        Option.match(
          () => [],
          (mime) => [["Content-Type", mime]],
        ),
      );

      // Create full route
      // There is maybe room to cache static files here
      // but the OS does that pretty good already.
      return Effect.gets((config) => [
        Builder.full_route(
          name,
          file_entry.parsed_path,
          Router.route(
            "GET",
            file_entry.relative_path,
            Builder.wrap_handler(
              Effect.tryCatch(async (..._) => {
                const stream = await config.fs.read(file_entry.parsed_path);
                return new Response(stream, { headers });
              }, (error, [_req, _url, ctx]) => {
                const err = static_builder_error("Unable to read static file", {
                  file_entry,
                  error,
                });
                ctx.logger.warn(err);
                return Router.text(
                  "Internal Server Error",
                  Router.STATUS_CODE.InternalServerError,
                );
              }),
              middleware,
            ),
          ),
        ),
      ]);
    },
  };
}
