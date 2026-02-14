/**
 * esbuild bundler for Deno + Preact applications.
 *
 * This module provides a bundler implementation that:
 * - Uses esbuild for fast bundling
 * - Handles JSX transformation with Preact
 * - Resolves Deno import maps
 * - Returns browser-compatible ES modules
 * - Includes content hashes in filenames for cache busting
 *
 * @module
 * @since 0.1.0
 */

import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";
import * as Either from "fun/either";
import * as Err from "fun/err";

import type { Bundler, BundleResult, OutputFile } from "@baetheus/pick/builder";

/**
 * Error type for bundler failures.
 *
 * @since 0.1.0
 */
export const bundler_error: Err.ErrFactory<"BundlerError"> = Err.err(
  "BundlerError",
);

/**
 * Configuration for the esbuild-deno-preact bundler.
 *
 * @since 0.1.0
 */
export type EsbuildDenoPreactConfig = {
  readonly jsx?: "transform" | "preserve" | "automatic";
  readonly jsxImportSource?: string;
  readonly treeShaking?: boolean;
  /** Minify the output (default: true) */
  readonly minify?: boolean;
  /** Generate source maps (default: false) */
  readonly sourcemap?: boolean | "inline" | "external";
  /** Enable code splitting (default: false) */
  readonly splitting?: boolean;
  /** Target environments (default: ["es2020"]) */
  readonly target?: string[];
  /** Base path for output file paths (default: "/") */
  readonly outbase?: string;
  /** Path to deno.json for import map resolution */
  readonly configPath?: string;
};

/**
 * Creates a bundler for Deno + Preact applications using esbuild.
 *
 * @example
 * ```ts
 * import { esbuild_deno_preact } from "pick/bundlers/esbuild-deno-preact";
 *
 * const bundler = esbuild_deno_preact({
 *   minify: true,
 *   sourcemap: false,
 * });
 *
 * const result = await bundler("/path/to/client.tsx");
 * ```
 *
 * @since 0.1.0
 */
export function esbuild_deno_preact(
  config: EsbuildDenoPreactConfig = {},
): Bundler {
  const {
    minify = true,
    treeShaking = true,
    sourcemap = true,
    splitting = false,
    target = ["es2020"],
    jsx = "automatic",
    jsxImportSource = "preact",
    outbase,
    configPath,
  } = config;

  return async (
    entrypoint: string,
  ): Promise<Either.Either<Err.AnyErr, BundleResult>> => {
    try {
      // Get the directory of the entrypoint for output path calculation
      const entrypointDir = entrypoint.substring(
        0,
        entrypoint.lastIndexOf("/"),
      );

      const result = await esbuild.build({
        entryPoints: [entrypoint],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        treeShaking,
        minify,
        sourcemap,
        splitting,
        target,
        outbase: outbase ?? entrypointDir,
        outdir: "/", // Virtual output directory
        jsx,
        jsxImportSource,
        // Content hash in filenames for cache busting
        entryNames: "[dir]/[name].[hash]",
        chunkNames: "[name].[hash]",
        assetNames: "[name].[hash]",
        // Deno-specific plugins for import map resolution
        // Type assertion needed due to minor esbuild version differences
        plugins: denoPlugins({ configPath }) as esbuild.Plugin[],
      });

      // Transform esbuild output files to our OutputFile type
      const files: OutputFile[] = result.outputFiles?.map((file) => ({
        // Normalize the path to be relative to site root
        path: file.path.startsWith("/") ? file.path : `/${file.path}`,
        contents: file.contents,
      })) ?? [];

      return Either.right({ files });
    } catch (error) {
      return Either.left(
        bundler_error("Failed to bundle client", { error, entrypoint }),
      );
    }
  };
}
