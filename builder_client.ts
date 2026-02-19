import * as Effect from "@baetheus/fun/effect";
import * as Err from "@baetheus/fun/err";
import * as esbuild from "esbuild";
import { pipe } from "@baetheus/fun/fn";
import { denoPlugins } from "@luca/esbuild-deno-loader";

import * as Builder from "./builder.ts";

const client_builder_error = Err.err("ClientBuilderError");

export type ClientBuilderOptions = {
  readonly name: string;
  readonly title: string;
  readonly jsx: "transform" | "preserve" | "automatic";
  readonly jsxImportSource: string;
  readonly treeShaking: boolean;
  readonly minify: boolean;
  readonly sourcemap: boolean | "inline" | "external";
  readonly splitting: boolean;
  readonly target: string[];
  readonly configPath: string;
  readonly include_extensions: string[];
};

export function client_builder({
  name = "DefaultClientBuilder",
  minify = true,
  treeShaking = true,
  sourcemap = true,
  splitting = false,
  target = ["es2020"],
  jsx = "automatic",
  jsxImportSource = "preact",
  include_extensions = [".ts", ".tsx"],
}: Partial<ClientBuilderOptions> = {}): Builder.Builder {
  const processed_files = new Set<Builder.FileEntry>();

  return {
    name,
    // TODO: implement full process_build where we create the bundle.
    process_build: (routes) => Effect.right(routes),
    process_file: (file_entry) => {
      // Bail on non-included extensions
      if (!include_extensions.includes(file_entry.parsed_path.ext)) {
        return Effect.right([]);
      }

      // Add processed file to our internal cache for the process_build step.
      processed_files.add(file_entry);

      // TODO: Implement client file processing
      return Effect.left(
        client_builder_error(
          "Builder#process_file not implemented for DefaultClientBuilder",
        ),
      );
    },
  };
}
