import type { In, Kind, Out } from "fun/kind.ts";

import * as P from "fun/promise.ts";

export type Handler<D, A, B = D> = (d: D) => Promise<[A, B]>;

export type Responder<D, A> = (d: D) => A | Promise<A>;

export interface KindHandler extends Kind {
  readonly kind: Handler<In<this, 0>, Out<this, 0>, Out<this, 1>>;
}

export type FromResponder<T> = T extends Responder<infer D, infer A>
  ? Handler<D, A>
  : never;

export type FromHandler<T> = T extends Handler<infer D, infer A, infer _>
  ? Responder<D, A>
  : never;

export function fromResponder<D, A>(responder: Responder<D, A>): Handler<D, A> {
  return async (d) => [await responder(d), d];
}

export function fromHandler<D, A, B>(
  handler: Handler<D, A, B>,
): Responder<D, A> {
  return async (d) => (await handler(d))[0];
}

export function id<S>(): Handler<S, S, S> {
  return (s) => P.resolve([s, s]);
}

export function wrap<A, D = unknown>(a: A): Handler<D, A, D> {
  return (d) => P.resolve([a, d]);
}

export function map<A, I>(
  fai: (a: A) => I,
): <S1, S2>(ua: Handler<S1, A, S2>) => Handler<S1, I, S2> {
  return (ua) => async (s1) => {
    const [a, s2] = await ua(s1);
    return [fai(a), s2];
  };
}

export function mapSecond<S2, S3>(
  fs: (s2: S2) => S3,
): <A, S1>(ua: Handler<S1, A, S2>) => Handler<S1, A, S3> {
  return (ua) => async (s1) => {
    const [a, s2] = await ua(s1);
    return [a, fs(s2)];
  };
}

export function apply<A, S3, S2>(
  ua: Handler<S2, A, S3>,
): <I, S1>(ufai: Handler<S1, (a: A) => I, S2>) => Handler<S1, I, S3> {
  return (ufai) => async (s1) => {
    const [fai, s2] = await ufai(s1);
    const [a, s3] = await ua(s2);
    return [fai(a), s3];
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
  return (s) => P.resolve([s, s]);
}

export function put<S>(s: S): Handler<S, void> {
  return () => P.resolve([undefined, s]);
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
