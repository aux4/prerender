#### Description

The `site` command turns a running Single Page Application into per-route static HTML for SEO. For each route it drives a headless browser (via `aux4/browser`) to the locally-served SPA, waits for the client-side render to finish, captures the fully-rendered DOM, and writes it to `<output>/<route>/index.html`. Crawlers and social scrapers that do not execute JavaScript then receive real content instead of an empty `<div id="root"></div>` shell.

The prerender is **hydration-safe**: the captured HTML keeps every `<script>` and asset tag intact, so when a real visitor loads the page the SPA still boots and hydrates over the static markup.

It wraps `aux4/browser` end to end and needs no other tooling:

- **Starts and stops the browser daemon** automatically (`aux4 browser start` / `aux4 browser stop`).
- **Resolves routes** from either a `sitemap.xml` (local path OR URL — its `<loc>` entries become the routes, with the origin stripped to derive each path) or an explicit comma/newline separated list of paths.
- **Waits per route** using the chosen navigation strategy (`--waitUntil`), then a best-effort network-idle wait, then a fixed `--settle` delay, before capturing `document.documentElement.outerHTML`.
- **Maps routes to files**: `/` becomes `<output>/index.html`, `/about` (or `/about/`) becomes `<output>/about/index.html`. A `<!doctype html>` prefix is added when the captured HTML lacks one.
- **Runs in parallel** up to `--concurrency` routes at once, one browser session each.
- **Continues past per-route failures** (logged to stderr) but exits with a non-zero status if any route failed, so CI can catch a broken prerender.

Single responsibility: this command **only** prerenders. It does not deploy or sync to S3 — that stays in the consumer's existing deploy step.

#### Usage

```bash
aux4 prerender site --baseUrl <url> --routes <sitemap|list> --output <dir> [--waitUntil <strategy>] [--settle <ms>] [--concurrency <n>]
```

--baseUrl      Base URL of the built SPA served locally, e.g. `http://localhost:4173` (required)
--routes       A `sitemap.xml` (local path OR URL) whose `<loc>` entries are the routes, OR an explicit comma/newline separated list of paths such as `"/,/about,/pricing"` (required)
--output       Directory to write `<route>/index.html` into, typically the built `dist` (required)
--waitUntil    Navigation wait strategy: `domcontentloaded`, `load`, `networkidle`, or `settle` (default: `networkidle`)
--settle       Extra delay in milliseconds after network idle, before capturing the HTML (default: `500`)
--concurrency  Number of routes to prerender in parallel, one browser session each (default: `4`)

#### Example

Serve the built SPA locally, then prerender every route in its sitemap into `dist`:

```bash
aux4 prerender site \
  --baseUrl http://localhost:4173 \
  --routes dist/sitemap.xml \
  --output dist
```

```text
Prerendering 6 route(s) from http://localhost:4173 into dist
  ok    / -> dist/index.html
  ok    /community -> dist/community/index.html
  ok    /for/developers -> dist/for/developers/index.html
  ok    /for/cto -> dist/for/cto/index.html
  ok    /for/cfo -> dist/for/cfo/index.html
  ok    /for/devops -> dist/for/devops/index.html
Prerendered 6/6 route(s)
```

Prerender an explicit list of routes instead of a sitemap:

```bash
aux4 prerender site \
  --baseUrl http://localhost:4173 \
  --routes "/,/pricing,/about" \
  --output dist \
  --waitUntil networkidle \
  --settle 800 \
  --concurrency 4
```

Prerender a real, live site with a one-line sitemap (or an inline route). A bare `/` is a single-route list, not a file, so this captures just the home page of `example.com`:

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

A typical CI pattern — build the SPA, serve the built `dist` locally, then prerender the built sitemap back into `dist` so CI never reaches out to any external site:

```bash
npm run build                      # produces dist/ + dist/sitemap.xml
npx serve -s dist -l 4173 &        # serve dist locally with SPA fallback
aux4 prerender site \
  --baseUrl http://localhost:4173 \
  --routes dist/sitemap.xml \
  --output dist
# then deploy dist as usual (prerender never deploys)
```
