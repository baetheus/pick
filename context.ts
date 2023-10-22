/**
 * Context for a request.
 */
export type Context<V, S> = {
  readonly request: Request;
  readonly variables: V;
  readonly state: S;
};

export function context<V, S>(
  request: Request,
  variables: V,
  state: S,
): Context<V, S> {
  return { request, variables, state };
}
