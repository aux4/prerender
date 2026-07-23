# prerender site

Prerender a tiny local SPA fixture and assert that the captured HTML contains the
rendered content AND still references the JS bundle (so client hydration works).

The static server is started inline in `beforeAll` (a `node -e` CommonJS one-liner
with SPA fallback) because `beforeAll` runs before `file:` fixtures are written, so
it cannot depend on a fixture server script existing yet. The SPA `index.html`
fixture is only read per-request, by which time the fixtures have been written.

## prerendering a local SPA from a sitemap

The fixture SPA serves an empty `<div id="root"></div>` shell plus a script that
injects route-specific text after load — exactly the crawler-hostile shape this
package fixes.

```file:spa/index.html
<!doctype html>
<html>
  <head>
    <title>Fixture SPA</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/assets/app.js"></script>
    <script>
      setTimeout(function () {
        var path = location.pathname;
        var text = path === "/about" ? "About aux4 prerender" : "Home of aux4 prerender";
        document.getElementById("root").innerHTML = "<h1>" + text + "</h1>";
      }, 50);
    </script>
  </body>
</html>
```

```file:sitemap.xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>http://localhost:47823/</loc>
  </url>
  <url>
    <loc>http://localhost:47823/about</loc>
  </url>
</urlset>
```

```beforeAll
nohup node -e 'const http=require("http"),fs=require("fs"),path=require("path");const dir="spa",port=47823;http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/assets/app.js"){res.writeHead(200,{"Content-Type":"application/javascript"});return res.end("// app bundle");}if(p.endsWith("/"))p+="index.html";const f=path.join(dir,p);fs.readFile(f,(err,data)=>{if(err){fs.readFile(path.join(dir,"index.html"),(e2,d2)=>{res.writeHead(200,{"Content-Type":"text/html"});res.end(d2||"not found");});}else{res.writeHead(200,{"Content-Type":"text/html"});res.end(data);}});}).listen(port,()=>console.log("up "+port));' >/tmp/pr-server-47823.log 2>&1 &
sleep 2
```

```afterAll
pkill -f "47823"
aux4 browser stop
rm -rf out
```

### should prerender every route in the sitemap

```timeout
120000
```

```execute
aux4 prerender site --baseUrl http://localhost:47823 --routes sitemap.xml --output out --settle 300
```

```expect:partial
Prerendered 2/2 route(s)
```

### should write the root route to output/index.html with the rendered content

```execute
cat out/index.html
```

```expect:partial
**Home of aux4 prerender**
```

### should keep the JS bundle script tag intact for hydration

```execute
cat out/index.html
```

```expect:partial
**src="/assets/app.js"**
```

### should prefix the captured HTML with a doctype

```execute
cat out/index.html
```

```expect:partial
<!doctype html>
```

### should write the about route to output/about/index.html with its own content

```execute
cat out/about/index.html
```

```expect:partial
**About aux4 prerender**
```

## prerendering an explicit route list

```file:spa/index.html
<!doctype html>
<html>
  <head>
    <title>Fixture SPA</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/assets/app.js"></script>
    <script>
      setTimeout(function () {
        document.getElementById("root").innerHTML = "<h1>Listed " + location.pathname + "</h1>";
      }, 50);
    </script>
  </body>
</html>
```

```beforeAll
nohup node -e 'const http=require("http"),fs=require("fs"),path=require("path");const dir="spa",port=47824;http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/assets/app.js"){res.writeHead(200,{"Content-Type":"application/javascript"});return res.end("// app bundle");}if(p.endsWith("/"))p+="index.html";const f=path.join(dir,p);fs.readFile(f,(err,data)=>{if(err){fs.readFile(path.join(dir,"index.html"),(e2,d2)=>{res.writeHead(200,{"Content-Type":"text/html"});res.end(d2||"not found");});}else{res.writeHead(200,{"Content-Type":"text/html"});res.end(data);}});}).listen(port,()=>console.log("up "+port));' >/tmp/pr-server-47824.log 2>&1 &
sleep 2
```

```afterAll
pkill -f "47824"
aux4 browser stop
rm -rf out2 out2single
```

### should prerender a comma-separated list of paths

```timeout
120000
```

```execute
aux4 prerender site --baseUrl http://localhost:47824 --routes "/,/pricing" --output out2 --settle 300
```

```expect:partial
Prerendered 2/2 route(s)
```

### should render the pricing route from the explicit list

```execute
cat out2/pricing/index.html
```

```expect:partial
**Listed /pricing**
```

### should prerender a single bare "/" route without mis-detecting it as a file

A bare `/` is not an existing file, so it must be treated as a one-item route
list (the root route) — not as the root directory, which used to fail with
`EISDIR`.

```timeout
120000
```

```execute
aux4 prerender site --baseUrl http://localhost:47824 --routes "/" --output out2single --settle 300
```

```expect:partial
Prerendered 1/1 route(s)
```

### should write the single root route to output/index.html

```execute
cat out2single/index.html
```

```expect:partial
**Listed /**
```

## validation

### should fail when baseUrl is missing

```execute
aux4 prerender site --routes "/" --output out3
```

```error:partial
Error: --baseUrl is required
```
