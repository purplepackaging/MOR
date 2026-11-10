const { chromium } = require("playwright");
const fs = require("fs");
const axe = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.BASE ?? "http://localhost:3123";
const pages = ["/", "/products", "/products/containers/bagasse-hinged", "/products/containers/clear-containers", "/ar/products/containers/kraft-takeout-boxes", "/es/products/cups-lids/hot-cups", "/tr/products/napkins-paper/guest-checks", "/products/gloves-safety/face-masks", "/products/cleaning/mops-brooms", "/products/foil-wrap/chafing-fuel", "/list"];
(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp });
    // seed a list so the list page renders lines
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("mor.list.v1")) localStorage.setItem("mor.list.v1", JSON.stringify([{ sku: "CUP-PET-16", cases: 4 }, { sku: "HMF-993W", cases: 2 }])); } catch {} });
    const p = await ctx.newPage();
    for (const path of pages) {
      const res = await p.goto(BASE + path, { waitUntil: "networkidle" });
      await p.addScriptTag({ content: axe });
      const r = await p.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
      const sw = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const v = r.violations.map((x) => `${x.impact} ${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")}`);
      console.log(`${vp.width} ${path} ${res.status()}${sw ? " HSCROLL" : ""} ${v.length ? "\n   " + v.join("\n   ") : "ok"}`);
    }
    await ctx.close();
  }
  await b.close();
})();
