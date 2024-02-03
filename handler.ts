import type { Kind, Out } from "fun/kind";
import type { Flatmappable } from "fun/flatmappable";

import * as P from "fun/promise";
import { pipe } from "fun/fn";

export type Handler<D, A, B> = (d: D) => Promise<[A, B]>;

export interface KindHandler<S> extends Kind {
  readonly kind: Handler<S, Out<this, 0>, S>;
}

export function id<S>(): Handler<S, S, S> {
  return (s) => Promise.resolve([s, s]);
}

export function delay(
  ms: number,
): <D, A, B>(ua: Handler<D, A, B>) => Handler<D, A, B> {
  return (ua) => async (s) => {
    await P.wait(ms);
    return ua(s);
  };
}

export function wrap<A, D = unknown>(a: A | Promise<A>): Handler<D, A, D> {
  return async (d) => [await a, d];
}

export function premap<L, D>(
  fld: (l: L) => D,
): <A, B>(ua: Handler<D, A, B>) => Handler<L, A, B> {
  return (ua) => (l) => ua(fld(l));
}

export function map<A, I>(
  fai: (a: A) => I | Promise<I>,
): <S1, S2>(ua: Handler<S1, A, S2>) => Handler<S1, I, S2> {
  return (ua) => async (s1) => {
    const [a, s2] = await ua(s1);
    return [await fai(a), s2];
  };
}

export function mapSecond<S2, S3>(
  fs: (s2: S2) => S3 | Promise<S3>,
): <A, S1>(ua: Handler<S1, A, S2>) => Handler<S1, A, S3> {
  return (ua) => async (s1) => {
    const [a, s2] = await ua(s1);
    return [a, await fs(s2)];
  };
}

export function apply<A, S3, S2>(
  ua: Handler<S2, A, S3>,
): <I, S1>(
  ufai: Handler<S1, (a: A) => I | Promise<I>, S2>,
) => Handler<S1, I, S3> {
  return (ufai) => async (s1) => {
    const [fai, s2] = await ufai(s1);
    const [a, s3] = await ua(s2);
    return [await fai(a), s3];
  };
}

export function flatmap<A, I, S2, S3>(
  faui: (a: A) => Handler<S2, I, S3>,
): <S1>(ua: Handler<S1, A, S2>) => Handler<S1, I, S3> {
  return (ua) => async (s1) => {
    const [a, s2] = await ua(s1);
    const ui = faui(a);
    return ui(s2);
  };
}

export function get<S>(): Handler<S, S, S> {
  return (s) => Promise.resolve([s, s]);
}

export function put<S>(s: S): Handler<S, void, S> {
  return () => Promise.resolve([undefined, s]);
}

export function puts<S, A>(fsa: (s: S) => A | Promise<A>): Handler<S, A, S> {
  return async (s) => [await fsa(s), s];
}

export function evaluate<S>(s: S): <A, O>(ua: Handler<S, A, O>) => Promise<A> {
  return async (ua) => (await ua(s))[0];
}

export function execute<S>(s: S): <A, O>(ua: Handler<S, A, O>) => Promise<O> {
  return async (ua) => (await ua(s))[1];
}

export function tap<A>(
  fa: (a: A) => unknown,
): <S, O>(ua: Handler<S, A, O>) => Handler<S, A, O> {
  return flatmap((a) => {
    fa(a);
    return wrap(a);
  });
}

export function bind<N extends string, A, I, S2, S3>(
  name: Exclude<N, keyof A>,
  faui: (a: A) => Handler<S2, I, S3>,
): <S1>(
  ua: Handler<S1, A, S2>,
) => Handler<
  S1,
  { readonly [K in keyof A | N]: K extends keyof A ? A[K] : I },
  S3
> {
  return <S1>(ua: Handler<S1, A, S2>) => {
    type Return = { readonly [K in keyof A | N]: K extends keyof A ? A[K] : I };
    return pipe(
      ua,
      flatmap((a) => map((i) => ({ ...a, [name]: i }) as Return)(faui(a))),
    );
  };
}

export function bindTo<N extends string>(
  name: N,
): <S1, A, S2>(
  ua: Handler<S1, A, S2>,
) => Handler<S1, { readonly [K in N]: A }, S2> {
  return map((value) => ({ [name]: value }) as { [K in N]: typeof value });
}

export function getFlatmappableHandler<S>(): Flatmappable<KindHandler<S>> {
  return { wrap, apply, map, flatmap };
}
