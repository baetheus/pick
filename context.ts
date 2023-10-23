/**
 * Context for a request.
 */
export type Context<S = unknown, V = unknown> = {
  readonly request: Request;
  readonly state: S;
  readonly variables: V;
};

export function context<S, V>(
  request: Request,
  state: S,
  variables: V,
): Context<S, V> {
  return { state, request, variables };
}
