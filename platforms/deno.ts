/**
 * Deno-specific BuilderTools implementation.
 *
 * Provides platform tools for building sites on Deno runtime.
 *
 * @module
 * @since 0.1.0
 */

import { walk } from "jsr:@std/fs@^1.0.19";
import { contentType } from "jsr:@std/media-types@^1.1.0";
import { basename, dirname, extname, relative } from "jsr:@std/path@^1.1.2";

import * as O from "fun/option";

import type { BuilderTools, WalkEntry } from "../builder.ts";
import { DEFAULT_LOGGER } from "../router.ts";
import type { Logger } from "../router.ts";

/**
 * Creates BuilderTools for Deno runtime.
 *
 * @example
 * ```ts
 * import * as B from "pick/builder";
 * import { deno_tools } from "pick/platforms/deno";
 *
 * const site = await B.build_site({
 *   root_path: "./routes",
 *   tools: deno_tools(),
 *   state: {},
 * });
 * ```
 *
 * @since 0.1.0
 */
export function deno_tools(logger: Logger = DEFAULT_LOGGER): BuilderTools {
  return {
    logger,

    async *walk(path: string): AsyncIterable<WalkEntry> {
      for await (const entry of walk(path)) {
        yield {
          is_file: entry.isFile,
          is_directory: entry.isDirectory,
          is_symlink: entry.isSymlink,
          name: entry.name,
          path: entry.path,
        };
      }
    },

    extname(path: string): string {
      return extname(path);
    },

    basename(path: string): string {
      return basename(path);
    },

    dirname(path: string): string {
      return dirname(path);
    },

    relative(from: string, to: string): string {
      return relative(from, to);
    },

    async read_stream(path: string): Promise<ReadableStream<Uint8Array>> {
      const file = await Deno.open(path, { read: true });
      return file.readable;
    },

    mime_type(extension: string): O.Option<string> {
      const mime = contentType(extension);
      return mime ? O.some(mime) : O.none;
    },
  };
}
