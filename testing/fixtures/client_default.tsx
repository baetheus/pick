import * as Tokens from "@baetheus/pick/tokens";

function NotFoundPage() {
  return <div>404 - Page Not Found</div>;
}

export const notFound = Tokens.client_default.create(NotFoundPage);
