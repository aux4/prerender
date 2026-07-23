# aux4/prerender

Turn a running Single Page Application into per-route static HTML for SEO — hydration-safe prerendering built entirely on top of `aux4/browser`.

React (and other client-rendered) SPAs ship an empty `<div id="root"></div>` shell and render everything in the browser. Crawlers and social scrapers that do not run JavaScript therefore see no content, no per-page title, and no meta tags. `aux4/prerender` fixes that: it drives a headless browser to each route of your locally-served build, waits for the client render to finish, and writes the fully-rendered HTML back into your `dist` — while keeping the `<script>`/asset tags intact so the SPA still boots and hydrates for real visitors.

It is designed for SPAs hosted on the `terraform-aws-website` (S3 + CloudFront) stack, where `/route/index.html` files are served directly and unknown paths fall back to the SPA — so trailing-slash `<route>/index.html` snapshots drop straight in.

## Installation

```bash
aux4 aux4 pkger install aux4/prerender
```

This also pulls in its dependency, `aux4/browser`.

## Quick Start

Build your SPA, serve the build locally, then prerender every route in its sitemap:

```bash
# 1. build your SPA (however your project does it), producing ./dist
# 2. serve the build locally on some port, e.g. http://localhost:4173
# 3. prerender it in place
aux4 prerender site \
  --baseUrl http://localhost:4173 \
  --routes dist/sitemap.xml \
  --output dist
```

Each route is written to `dist/<route>/index.html`, replacing the empty shell with rendered content.

## Command

### prerender site

Visit every route of a locally-served SPA and write each rendered page to `<output>/<route>/index.html`.

```bash
aux4 prerender site --baseUrl <url> --routes <sitemap|list> --output <dir> [--waitUntil <strategy>] [--settle <ms>] [--concurrency <n>]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--baseUrl` | Base URL of the built SPA served locally, e.g. `http://localhost:4173` | *(required)* |
| `--routes` | A `sitemap.xml` (local path OR URL) whose `<loc>` entries are the routes, OR an explicit comma/newline separated list of paths (e.g. `"/,/about,/pricing"`) | *(required)* |
| `--output` | Directory to write `<route>/index.html` into, typically the built `dist` | *(required)* |
| `--waitUntil` | Navigation wait strategy: `domcontentloaded`, `load`, `networkidle`, or `settle` | `networkidle` |
| `--settle` | Extra delay in milliseconds after network idle, before capturing the HTML | `500` |
| `--concurrency` | Number of routes to prerender in parallel, one browser session each | `4` |

## How it works

For each route, `prerender site`:

1. Starts the `aux4/browser` daemon (once, for the whole run).
2. Opens up to `--concurrency` browser sessions and pulls routes from a queue.
3. Visits `<baseUrl><path>` with the `--waitUntil` strategy, does a best-effort network-idle wait, then waits `--settle` milliseconds.
4. Captures `document.documentElement.outerHTML`, prefixes a `<!doctype html>` when missing, and writes it to `<output>/<path>/index.html` (`/` maps to `index.html`).
5. Stops the browser daemon at the end.

The captured HTML keeps every `<script>` and asset tag, so hydration works. A route that fails is logged and skipped, but the command exits non-zero if any route failed — so a broken prerender fails CI.

### Route resolution

`--routes` accepts, in order of detection:

- **A URL** (`http://` / `https://`) — fetched; if the body is a sitemap, its `<loc>` entries become the routes.
- **A local file path** — read; a sitemap is parsed for `<loc>` entries, otherwise the file is treated as a comma/newline separated list of paths.
- **A literal list** — a comma/newline separated string of paths, e.g. `"/,/about,/pricing"`. A single bare route such as `"/"` is a one-item list — it is only treated as a file when it ends in `.xml` or is an existing readable file, so `--routes "/"` prerenders just the home page.

Sitemap `<loc>` values may be absolute URLs (the origin is stripped to derive the path) or bare paths.

### Output mapping

| Route | Output file |
|-------|-------------|
| `/` | `<output>/index.html` |
| `/about` | `<output>/about/index.html` |
| `/for/cto/` | `<output>/for/cto/index.html` |

## Real-site example

Prerender any live site by pointing `--baseUrl` at it and giving `--routes` a one-line sitemap (or an explicit route list). For example, capture the rendered home page of `example.com` into `./out`:

```bash
printf '/\n' > routes.txt
aux4 prerender site \
  --baseUrl https://example.com \
  --routes routes.txt \
  --output out
```

```text
Prerendering 1 route(s) from https://example.com into out
  ok    / -> out/index.html
Prerendered 1/1 route(s)
```

The same works with a single inline route — `--routes "/"` prerenders just the home page — or a comma-separated list, e.g. `--routes "/,/about"`.

## docs.aux4.io CI pattern

`docs.aux4.io` (and the other aux4 React SPAs on the `terraform-aws-website` stack) prerender in CI by building the SPA, serving the built `dist` locally, and pointing `prerender site` at that local server with the built sitemap:

```bash
# 1. build the SPA to dist (includes dist/sitemap.xml)
npm run build

# 2. serve dist locally with SPA fallback, backgrounded, on a fixed port
npx serve -s dist -l 4173 &

# 3. prerender every route in the sitemap back into dist, in place
aux4 prerender site \
  --baseUrl http://localhost:4173 \
  --routes dist/sitemap.xml \
  --output dist

# 4. deploy dist (unchanged — prerender never deploys)
```

Because the routes come from `dist/sitemap.xml` served locally, CI never depends on any external site being reachable.

## Single responsibility

`aux4/prerender` **only** prerenders. It does not deploy, sync to S3, or invalidate a CDN — that stays in your existing deploy step. Run it right after your build, then deploy `dist` as you already do.

## Using it in CI (GitHub Actions)

1. Build your SPA to `dist`.
2. Serve the build locally on a fixed port (any static server with SPA fallback; e.g. `vite preview`, `npx serve`, or a tiny Node static server), backgrounded.
3. Run `aux4 prerender site --baseUrl http://localhost:<port> --routes dist/sitemap.xml --output dist`.
4. Deploy `dist`.

The browser daemon runs headless by default. Ensure the browser engine used by `aux4/browser` is installed on the runner (see the `aux4/browser` docs).

## Dependencies

- [`aux4/browser`](https://hub.aux4.io) — the headless browser daemon that provides every primitive used here.

## License

Apache-2.0
