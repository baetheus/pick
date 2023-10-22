import type { VNode } from "https://esm.sh/preact@10.18.1";

import { render } from "https://esm.sh/preact-render-to-string@6.2.2";

/** */
export function html(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function jsx(vnode: VNode): Response {
  return html(render(vnode));
}
