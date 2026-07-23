import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

// aux4/prerender is authored in executable.js (Node builtins only — fetch is a
// global on Node 18+). Rollup bundles it into a single self-contained ESM file
// at package/lib/aux4-prerender.mjs, which is the artifact that ships in the
// package and is executed by package/.aux4. This mirrors the build used by
// aux4/render and aux4/2table, so the command works after a normal aux4 package
// install (no node_modules present at runtime).
export default {
  input: "executable.js",
  output: {
    file: "package/lib/aux4-prerender.mjs",
    format: "esm",
    inlineDynamicImports: true,
    banner: "// GENERATED FILE — do not edit. Edit executable.js at the package root and run `npm run build`."
  },
  plugins: [
    json(),
    nodeResolve({
      preferBuiltins: true
    }),
    commonjs()
  ],
  external: ["fs", "path", "child_process"]
};
