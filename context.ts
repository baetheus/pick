/**
 * Context for a request.
 */
export type Context<S = unknown, V = unknown> = {
  readonly request: Request;
  readonly state: S;
  readonly path: V;
};

export function context<S, V>(
  request: Request,
  state: S,
  path: V,
): Context<S, V> {
  return { state, request, path };
}
