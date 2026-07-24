#!/usr/bin/env node

// aux4/prerender — turn a running SPA into per-route static HTML for SEO.
//
// This is the authored source. It is bundled by rollup into the self-contained
// package/lib/aux4-prerender.mjs artifact that ships in the package and is
// executed by package/.aux4 (mirroring aux4/render / aux4/2table). Edit THIS
// file, then run `npm run build`.
//
// Single action:
//   site <baseUrl> <routes> <output> <waitUntil> <settle> <concurrency>
//
// Flow (wraps aux4/browser — no changes to browser needed):
//   aux4 browser start
//   for each route (up to <concurrency> in parallel, one session each):
//     aux4 browser visit  --url <baseUrl><path> --waitUntil <waitUntil>
//     aux4 browser wait    --selector networkidle           (best-effort)
//     sleep <settle> ms
//     aux4 browser eval    --script document.documentElement.outerHTML
//     write <output>/<path>/index.html  ("/" -> index.html), doctype-prefixed
//   aux4 browser stop
//
// Per-route failures are logged and skipped; the process exits non-zero if any
// route failed. The <script>/asset tags in the captured HTML are left intact so
// client hydration still works.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run an aux4 command, resolving with stdout (rejecting with stderr on failure).
function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `exit ${code}`).trim()));
    });
  });
}

// Convert a sitemap <loc> or a raw list entry into an absolute route path.
function toPath(entry) {
  entry = String(entry).trim();
  if (/^https?:\/\//i.test(entry)) {
    try {
      const u = new URL(entry);
      return u.pathname + (u.search || "");
    } catch {
      return entry;
    }
  }
  return entry.startsWith("/") ? entry : "/" + entry;
}

// A --routes value is a file path only when it is an existing *readable file*
// (never a directory) or it explicitly ends in .xml. Everything else — including
// a bare "/" or "/foo" that is not a file on disk — is a route LIST. This avoids
// mis-detecting the root directory "/" as a sitemap file (which used to throw
// EISDIR on read).
function isRoutesFile(routes) {
  if (/\.xml$/i.test(routes)) return true;
  try {
    return fs.statSync(routes).isFile();
  } catch {
    return false;
  }
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// Resolve the routes argument into a list of paths. Accepts:
//   - a sitemap.xml URL   (http/https, parsed for <loc> entries)
//   - a sitemap.xml file  (local path or *.xml, parsed for <loc> entries)
//   - a local file with a comma/newline separated list of paths
//   - a literal comma/newline separated list of paths (incl. a single "/")
async function resolveRoutes(routes) {
  let content;
  if (/^https?:\/\//i.test(routes)) {
    const res = await fetch(routes);
    if (!res.ok) {
      throw new Error(`failed to fetch routes ${routes}: HTTP ${res.status}`);
    }
    content = await res.text();
  } else if (isRoutesFile(routes)) {
    content = fs.readFileSync(routes, "utf8");
  } else {
    content = routes;
  }

  if (/<loc>/i.test(content) || /<urlset/i.test(content) || /<sitemapindex/i.test(content)) {
    const locs = [...content.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1]);
    return dedupe(locs.map(toPath));
  }

  const list = content
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return dedupe(list.map(toPath));
}

// Map a route path to its output file: "/" -> <output>/index.html,
// "/about" or "/about/" -> <output>/about/index.html.
function outputFile(output, routePath) {
  let p = routePath.split("#")[0].split("?")[0];
  if (!p.startsWith("/")) p = "/" + p;
  if (p === "/" || p === "") return path.join(output, "index.html");
  p = p.replace(/\/+$/, "");
  return path.join(output, p, "index.html");
}

function joinUrl(baseUrl, routePath) {
  return baseUrl.replace(/\/+$/, "") + (routePath.startsWith("/") ? routePath : "/" + routePath);
}

async function renderRoute(session, baseUrl, routePath, output, waitUntil, settle) {
  const url = joinUrl(baseUrl, routePath);
  await sh("aux4", ["browser", "visit", "--session", session, "--url", url, "--waitUntil", waitUntil]);
  // Best-effort settle on network idle; a persistent connection can keep this
  // from firing, so a timeout here is not fatal — we still capture the DOM.
  await sh("aux4", ["browser", "wait", "--session", session, "--selector", "networkidle", "--timeout", "30000"]).catch(
    () => {}
  );
  if (settle > 0) await sleep(settle);

  // Before serializing, flush any CSS-in-JS rules (emotion / styled-components /
  // MUI) that were injected via CSSOM insertRule into their <style> tags. Those
  // rules live only in document.styleSheets, not in the DOM, so outerHTML would
  // otherwise drop them — shipping elements with css-* classNames but no rules,
  // which flashes unstyled until the JS re-injects them on hydration.
  let html = await sh("aux4", [
    "browser",
    "eval",
    "--session",
    session,
    "--script",
    "(function(){try{for(var i=0;i<document.styleSheets.length;i++){var s=document.styleSheets[i],n=s.ownerNode;if(n&&n.tagName==='STYLE'&&!n.textContent){var r=s.cssRules,c='';for(var j=0;j<r.length;j++)c+=r[j].cssText;if(c)n.textContent=c;}}}catch(e){}return document.documentElement.outerHTML;})()"
  ]);
  html = html.replace(/\s+$/, "");
  if (!html) throw new Error("empty HTML captured");
  if (!/^\s*<!doctype/i.test(html)) html = "<!doctype html>\n" + html;

  const file = outputFile(output, routePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html + "\n");
  return file;
}

async function prerenderSite({ baseUrl, routes, output, waitUntil, settle, concurrency }) {
  const paths = await resolveRoutes(routes);
  if (paths.length === 0) {
    throw new Error("no routes resolved from --routes");
  }

  console.log(`Prerendering ${paths.length} route(s) from ${baseUrl} into ${output}`);

  const queue = [...paths];
  const results = [];

  await sh("aux4", ["browser", "start"]).catch(() => {});

  async function worker() {
    let session;
    try {
      session = (await sh("aux4", ["browser", "open"])).trim();
    } catch (e) {
      // Could not open a session — drain the queue as failures.
      let p;
      while ((p = queue.shift()) !== undefined) {
        results.push({ path: p, ok: false, error: `open session: ${e.message}` });
        console.error(`  fail  ${p}: open session: ${e.message}`);
      }
      return;
    }
    try {
      let p;
      while ((p = queue.shift()) !== undefined) {
        try {
          const file = await renderRoute(session, baseUrl, p, output, waitUntil, settle);
          results.push({ path: p, ok: true, file });
          console.log(`  ok    ${p} -> ${file}`);
        } catch (e) {
          results.push({ path: p, ok: false, error: e.message });
          console.error(`  fail  ${p}: ${e.message}`);
        }
      }
    } finally {
      await sh("aux4", ["browser", "close", "--session", session]).catch(() => {});
    }
  }

  try {
    const workerCount = Math.max(1, Math.min(concurrency, paths.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    await sh("aux4", ["browser", "stop"]).catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  const ok = results.length - failed.length;
  console.log(`Prerendered ${ok}/${results.length} route(s)`);
  if (failed.length > 0) {
    console.error(`${failed.length} route(s) failed: ${failed.map((r) => r.path).join(", ")}`);
    process.exitCode = 1;
  }
}

async function main() {
  const [, , action, ...rest] = process.argv;
  if (action !== "site") {
    console.error(`Unknown action: ${action || "(none)"}. Expected: site`);
    process.exit(1);
  }

  const [baseUrl, routes, output, waitUntilArg, settleArg, concurrencyArg] = rest;

  if (!baseUrl) return fail("--baseUrl is required");
  if (!routes) return fail("--routes is required");
  if (!output) return fail("--output is required");

  const waitUntil = waitUntilArg || "networkidle";
  const settle = settleArg === undefined || settleArg === "" ? 500 : parseInt(settleArg, 10);
  const concurrency = concurrencyArg === undefined || concurrencyArg === "" ? 4 : parseInt(concurrencyArg, 10);

  if (Number.isNaN(settle) || settle < 0) return fail(`invalid --settle: ${settleArg}`);
  if (Number.isNaN(concurrency) || concurrency < 1) return fail(`invalid --concurrency: ${concurrencyArg}`);

  try {
    await prerenderSite({ baseUrl, routes, output, waitUntil, settle, concurrency });
  } catch (e) {
    fail(e.message);
  }
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

main();
