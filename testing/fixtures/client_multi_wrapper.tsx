import type { ComponentChildren } from "preact";
import * as Tokens from "@baetheus/pick/tokens";

function Wrapper1({ children }: { children: ComponentChildren }) {
  return <div class="wrapper1">{children}</div>;
}

function Wrapper2({ children }: { children: ComponentChildren }) {
  return <div class="wrapper2">{children}</div>;
}

// This file has TWO wrappers - should cause an error
export const wrapper1 = Tokens.client_wrapper.create(Wrapper1);
export const wrapper2 = Tokens.client_wrapper.create(Wrapper2);
