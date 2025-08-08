/**
 * This is an example of a single line Deno webserver that responds to every
 * request. I use it to benchmark the maximum number of requests that a Deno
 * webserver can handle on a given host.
 */
Deno.serve(() => new Response());
