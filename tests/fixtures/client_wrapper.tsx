import type { ComponentChildren } from "preact";
import * as Tokens from "@baetheus/pick/tokens";

function AppWrapper({ children }: { children: ComponentChildren }) {
  return (
    <div class="app-wrapper">
      <header>Header</header>
      <main>{children}</main>
      <footer>Footer</footer>
    </div>
  );
}

export const wrapper = Tokens.client_wrapper.create(AppWrapper);
