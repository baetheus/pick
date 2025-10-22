import * as E from "fun/effect";

import * as B from "../../builder.ts";
import * as R from "../../router.ts";

export const get = B.get(E.gets(() => R.text("Hello from a get")));
