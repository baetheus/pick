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

export const deno_fs: Filesystem = {
  walk: async (root) => {
    const normalized_root = normalize(root);
    return pipe(
      await Array.fromAsync(walk(normalized_root)),
      Arr.filter((walk_entry) => walk_entry.isFile),
      Arr.map((walk_entry) => {
        const normalized_path = normalize(walk_entry.path);
        const parsed_path = parse(normalized_path);
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
};
