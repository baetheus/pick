import type { Either } from "https://deno.land/x/fun/either.ts";

import * as E from "https://deno.land/x/fun/either.ts";
import * as D from "https://deno.land/x/fun/decoder.ts";
import * as S from "https://deno.land/x/fun/string.ts";
import * as A from "https://deno.land/x/fun/array.ts";
import { pipe, todo } from "https://deno.land/x/fun/fn.ts";

type Simplify<T> = { readonly [K in keyof T]: T[K] };
type Required<Key extends string> = { readonly [K in Key]: string };
type ParseResult<Verb, Path> = {
  readonly verb: Verb;
  readonly path: Path;
};
type HttpVerbs =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "DELETE"
  | "CONNECT"
  | "OPTIONS"
  | "TRACE"
  | "PATCH";
type ParseString = `${HttpVerbs} /${string}`;

// deno-fmt-ignore
export type ParsePath<P extends string, R extends Record<string, string> = Record<never, unknown>> =
  // Optional 
  P extends `:${infer Key}/${infer Part}` ? ParsePath<Part, R & Required<Key>>
  : P extends `${infer _}/${infer Part}` ? ParsePath<Part, R>
  : P extends `:${infer Key}` ? ParsePath<"", R & Required<Key>>
  : Simplify<R>;

export type ParseUri<P extends ParseString> = P extends
  `${infer Verb} /${infer Path}` ? ParseResult<Verb, ParsePath<Path>> : never;

const isNamed = S.startsWith(":");
const splitOnSlash = S.split("/");
const wordToDecoder = (word: string) =>
  isNamed(word) ? D.literal(word.slice(1, word.length)) : D.string;
const accumulateIndices = (
  indices: [number, string][],
  word: string,
  index: number,
): [number, string][] => {
  if (isNamed(word)) {
    indices.push([index, word.slice(1, word.length)]);
  }
  return indices;
};

export function createParsePath<P extends string>(
  path: P,
): (requestPath: string) => Either<string, ParsePath<P>> {
  const words = splitOnSlash(path);
  const indices = pipe(
    words,
    A.reduce(accumulateIndices, []),
  );
  const decoder = pipe(
    words,
    A.map(wordToDecoder),
    (words) => D.tuple(...words),
  );
  return (requestPath) =>
    pipe(
      splitOnSlash(requestPath),
      decoder,
      E.mapSecond(D.draw),
      E.map((result) =>
        pipe(
          indices,
          A.reduce((out, [index, key]) => {
            type Out = typeof out;
            out[key as keyof Out] = result[index] as Out[keyof Out];
            return out;
          }, {} as ParsePath<P>),
        )
      ),
    );
}

export function createParseUri<P extends ParseString>(
  input: P,
): (uri: string) => Either<string, ParseUri<P>> {
  // const
  return todo();
}

Deno.serve((_req) => {
  let timer: number;
  const body = new ReadableStream({
    async start(controller) {
      timer = setInterval(() => {
        controller.enqueue("Hello, World!\n");
      }, 1000);
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
});
