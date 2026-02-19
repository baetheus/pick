/**
 * Deno-specific filesystem implementation for the builder.
 *
 * This module provides a Filesystem implementation using Deno's built-in
 * file system APIs, suitable for use with the pick builder in Deno environments.
 *
 * @module
 * @since 0.1.0
 */

import * as Option from "@baetheus/fun/option";
import * as Arr from "@baetheus/fun/array";
import { walk } from "@std/fs";
import { format, normalize, parse, relative } from "@std/path";
import { contentType } from "@std/media-types";
import { pipe } from "@baetheus/fun/fn";

import { file_entry, type Filesystem } from "./builder.ts";

function get_mime_type(extension: string): Option.Option<string> {
  const mime = contentType(extension);
  return pipe(mime, Option.fromNullable);
}

/**
 * Deno filesystem implementation for the builder.
 *
 * Provides file operations using Deno's standard library functions
 * for walking directories, reading files, and writing files.
 *
 * @example
 * ```ts
 * import { deno_fs } from "@baetheus/pick/deno_fs";
 * import { build } from "@baetheus/pick/builder";
 *
 * const result = await build({
 *   root_path: "./src/routes",
 *   fs: deno_fs,
 *   unsafe_import: (path) => import(path),
 *   builders: [],
 * });
 * ```
 *
 * @since 0.1.0
 */
export const deno_fs: Filesystem = {
  makeTempFile: Deno.makeTempFile,
  walk: async (root) => {
    const normalized_root = normalize(root);
    return pipe(
      await Array.fromAsync(walk(normalized_root)),
      Arr.filter((walk_entry) => walk_entry.isFile),
      Arr.map((walk_entry) => {
        const normalized_path = normalize(walk_entry.path);
        const parsed_path = parse(normalized_path);
        console.log({ walk_entry, normalized_path, parsed_path });
        return file_entry(
          parsed_path,
          relative(normalized_root, normalized_path),
          get_mime_type(parsed_path.ext),
        );
      }),
    );
  },
  read: async (path) => {
    const file = await Deno.open(format(path), { read: true });
    return file.readable;
  },
  write: (path, data) => Deno.writeFile(format(path), data),
};
