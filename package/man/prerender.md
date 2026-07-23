#### Description

The `prerender` command group turns a running Single Page Application into per-route static HTML for SEO — hydration-safe prerendering built on top of `aux4/browser`. It is meant to run right after your SPA build, against the built app served locally, and it writes rendered `<route>/index.html` files back into your `dist` so crawlers and social scrapers receive real content instead of an empty `<div id="root"></div>` shell.

It has a single subcommand:

- **`site`** — visit every route of a locally-served SPA and write each rendered page to `<output>/<route>/index.html`, keeping the `<script>`/asset tags intact for hydration.

Single responsibility: it prerenders only. It does not deploy or sync to S3 — that stays in your existing deploy step.

#### Usage

```bash
aux4 prerender site --baseUrl <url> --routes <sitemap|list> --output <dir> [--waitUntil <strategy>] [--settle <ms>] [--concurrency <n>]
```

#### Example

```bash
aux4 prerender site \
  --baseUrl http://localhost:4173 \
  --routes dist/sitemap.xml \
  --output dist
```

See `aux4 aux4 man prerender site` for the full flag reference.
