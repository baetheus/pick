export type Handler<D, A, B = D> = (d: D) => Promise<[A, B]>;

export function id<S>(): Handler<S, S, S> {
  return (s) => Promise.resolve([s, s]);
}

export function wrap<A, D = unknown>(a: A | Promise<A>): Handler<D, A, D> {
  return async (d) => [await a, d];
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

export function put<S>(s: S): Handler<S, void> {
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
