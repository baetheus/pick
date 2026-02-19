import type { ClientIndexParameters } from "@baetheus/pick/tokens";
import * as Tokens from "@baetheus/pick/tokens";

function IndexPage({ scripts, styles, title }: ClientIndexParameters) {
  return (
    <html>
      <head>
        <title>{title}</title>
        {styles.map((s) => <link rel="stylesheet" href={s} />)}
      </head>
      <body>
        {scripts.map((s) => <script type="module" src={s} />)}
      </body>
    </html>
  );
}

export const index = Tokens.client_index.create(IndexPage);
