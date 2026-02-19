import type { AnyErr } from "@baetheus/fun/err";
import type { Either } from "@baetheus/fun/either";
import * as Builder from "./builder.ts";
import * as DenoFS from "./deno_fs.ts";
import * as BuilderClient from "./builder_client.ts";
import * as BuilderServer from "./builder_server.ts";
import * as BuilderStatic from "./builder_static.ts";

export default function build(
  root_path: string,
  site_name: string,
): Promise<Either<AnyErr, Builder.SiteBuildResult>> {
  return Builder.build({
    root_path,
    fs: DenoFS.deno_fs,
    builders: [
      BuilderClient.client_builder({ title: site_name }),
      BuilderServer.server_builder({}),
      BuilderStatic.static_builder(),
    ],
  });
}
