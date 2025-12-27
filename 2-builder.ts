/**
 * This is a generic builder for web applications that want to pair a typescript
 * backend with a SPA frontend and don't want to manage them separately. In
 * fact, the point of this project is to create a builder that takes in a
 * directory path, walks it, and returns a Router that automatically handles
 * static assets, backend routes, and the building and resolution of routes to
 * the frontend SPA (effectively returning the correct index.html at all
 * frontend routes).
 *
 * I'd also like to keep the interfaces generic enough that a sufficiently
 * motivated user could use runtimes and frontend frameworks that I do not.
 * Specifically, I prefer Deno and Preact, but I'd like this tool to be usable
 * with Node/Bun and React/Mithril/Blazor.
 *
 * # Build Process
 *
 * The generic phases of this project are organized like so:
 *
 * 1. Walker: Given a physical directory and a set of tools will walk the
 * directory and return an array of a readable stream, the canonical file path,
 * the relative path from the source directory to the file, the filename, the
 * extension, and the mime type if one exists.
 *
 * 2. The builder enters the server build phase. Each file entry returned by the
 * walker is filtered by extension, then an import is attempted of the file. If
 * the import is successful any partial route exports will be added to the
 * server route list and the file removed from the file queue. Otherwise, if it
 * fails a warning is logged and the file is left in the full file list. Output
 * is a list of routes with as much typing as we can create.
 *
 * 3. The builder enters the client build phase. Each remaining file entry is
 * is filtered by extension again, then an import is attempted of the file. The
 * first file that exports a client root will be used to both create the index
 * file as well as act as the entry point for the spa (for now only a single spa
 * is targeted). A different export will be used to mark files as routes used by
 * the frontend (which will be served the entrypoint index). Once all client
 * routes are found an in memory bundle is created as well as a readable stream
 * for the index file. Output is a list of routes with as much typing as we can
 * create.
 *
 * 4. The build enters the static build phase. All remaining routes are opened
 * into readable streams with routes that stream the responses. Output is a list
 * of routes with as much typing as we can create.
 *
 * 5. The server, client, and static outputs are combined into a router. It's
 * possible that some ordering will need to be done. Specifically for
 * overlapping url pattern paths in the same directory. Static paths should be
 * favored over perameterized paths, parameters should be sorted alphabetically.
 * Past mvp route conflicts should be warned.
 *
 * # Stretch goals
 *
 * 1. By default the builder will serve a directory. An alternative to output
 * the full application to an output directory would be nice (build instead of
 * run).
 * 2. A "dev" mode that watches for file changes, injects the spa refresher,
 * rebuilds the router, and sends new frontend events would be really cool.
 * 3. Generate OpenAPI specifications from the generated routes.
 */

