/**
 * Node.js-specific BuilderTools implementation.
 *
 * Provides platform tools for building sites on Node.js runtime.
 *
 * @module
 * @since 0.1.0
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { Readable } from "node:stream";
import * as O from "fun/option";

import type { BuilderTools, WalkEntry } from "../builder.ts";
import { DEFAULT_LOGGER } from "../router.ts";
import type { Logger } from "../router.ts";

/**
 * Common MIME type mappings for static files.
 *
 * @since 0.1.0
 */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

/**
 * Recursively walks a directory yielding WalkEntry objects.
 *
 * @since 0.1.0
 */
async function* walk_directory(path: string): AsyncIterable<WalkEntry> {
  const entries = await readdir(path, { withFileTypes: true });

  for (const entry of entries) {
    const full_path = join(path, entry.name);
    const stats = await stat(full_path);

    yield {
      is_file: stats.isFile(),
      is_directory: stats.isDirectory(),
      is_symlink: stats.isSymbolicLink(),
      name: entry.name,
      path: full_path,
    };

    if (stats.isDirectory()) {
      yield* walk_directory(full_path);
    }
  }
}

/**
 * Converts a Node.js Readable stream to a Web ReadableStream.
 *
 * @since 0.1.0
 */
function node_stream_to_web(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

/**
 * Creates BuilderTools for Node.js runtime.
 *
 * @example
 * ```ts
 * import * as B from "pick/builder";
 * import { node_tools } from "pick/platforms/node";
 *
 * const site = await B.build_site({
 *   root_path: "./routes",
 *   tools: node_tools(),
 *   state: {},
 * });
 * ```
 *
 * @since 0.1.0
 */
export function node_tools(logger: Logger = DEFAULT_LOGGER): BuilderTools {
  return {
    logger,

    walk(path: string): AsyncIterable<WalkEntry> {
      return walk_directory(path);
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
      const stream = createReadStream(path);
      return node_stream_to_web(stream);
    },

    mime_type(extension: string): O.Option<string> {
      const mime = MIME_TYPES[extension.toLowerCase()];
      return mime ? O.some(mime) : O.none;
    },
  };
}
