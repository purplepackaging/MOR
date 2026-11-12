// Product photos. Every photo comes in two files, the browser takes the small one for cards and the
// large one for the product page, and a tile that holds a photo has its floor and its shadow.
// Run against any build of the site (items hidden or shown).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE ?? "http://localhost:3123";
const ROOT = path.join(__dirname, "..", "..");
const DIR = path.join(ROOT, "public/img/products");
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const kb = (file) => Math.round(fs.statSync(path.join(DIR, file)).size / 1024);

// Every photo the catalog names, products and categories alike.
const NAMES = [...new Set([...fs.readFileSync(path.join(ROOT, "src/data/catalog.ts"), "utf8").matchAll(/image:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();

(async () => {
  // 1. The files.
  const missing = NAMES.flatMap((n) => [`${n}.webp`, `${n}-480.webp`]).filter((f) => !fs.existsSync(path.join(DIR, f)));
  check(NAMES.length >= 70 && missing.length === 0, `all ${NAMES.length} catalog photos have both files${missing.length ? " -> missing " + missing.join(", ") : ""}`);
  const heavySmall = NAMES.filter((n) => kb(`${n}-480.webp`) > 60);
  const heavyFull = NAMES.filter((n) => kb(`${n}.webp`) > 200);
  check(heavySmall.length === 0, `no small copy is over 60 KB${heavySmall.length ? " -> " + heavySmall.join(", ") : ""}`);
  check(heavyFull.length === 0, `no full photo is over 200 KB${heavyFull.length ? " -> " + heavyFull.join(", ") : ""}`);

  const browser = await chromium.launch();

  // 2. Their sizes, as the browser reads them.
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE + "/privacy");
    const sizes = await p.evaluate(async (names) => {
      const load = (src) => new Promise((done) => { const i = new Image(); i.onload = () => done([i.naturalWidth, i.naturalHeight]); i.onerror = () => done(null); i.src = src; });
      const out = {};
      for (const n of names) out[n] = { full: await load(`/img/products/${n}.webp`), small: await load(`/img/products/${n}-480.webp`) };
      return out;
    }, NAMES);
    const broken = NAMES.filter((n) => !sizes[n].full || !sizes[n].small);
    check(broken.length === 0, `the site serves both files of every photo${broken.length ? " -> " + broken.join(", ") : ""}`);
    const long = (wh) => Math.max(...wh);
    const tooSmall = NAMES.filter((n) => sizes[n].full && long(sizes[n].full) < 600);
    check(tooSmall.length === 0, `every photo is 600 px or more on its long side${tooSmall.length ? " -> " + tooSmall.join(", ") : ""}`);
    const wrongCopy = NAMES.filter((n) => {
      const { full, small } = sizes[n];
      if (!full || !small) return false;
      const k = Math.min(1, 480 / long(full));
      return Math.abs(small[0] - full[0] * k) > 1.5 || Math.abs(small[1] - full[1] * k) > 1.5;
    });
    check(wrongCopy.length === 0, `every small copy is its photo at 480 px on the long side${wrongCopy.length ? " -> " + wrongCopy.join(", ") : ""}`);
    await ctx.close();
  }

  // 3. Which file the browser takes, on four screens.
  const product = await (async () => {
    const page = await (await fetch(BASE + "/products")).text();
    return page.match(/href="(\/products\/[a-z-]+\/[a-z0-9-]+)"/)?.[1];
  })();
  check(!!product, `the products page links to a product (${product})`);
  for (const [label, width, height, dpr, bigOnProductPage] of [
    ["a phone (390 px, 3x)", 390, 844, 3, true],
    ["a tablet (768 px, 2x)", 768, 1024, 2, true],
    ["a laptop (1280 px, 1x)", 1280, 800, 1, false],
    ["a sharp laptop (1280 px, 2x)", 1280, 800, 2, true],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } });
    await p.waitForFunction(() => [...document.querySelectorAll(".tile img")].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    const cards = await p.evaluate(() => [...document.querySelectorAll(".tile img")].map((i) => ({ src: i.currentSrc.split("/").pop().split("?")[0], ok: i.complete && i.naturalWidth > 0, drawn: i.getBoundingClientRect().width })));
    const notSmall = cards.filter((c) => !c.src.endsWith("-480.webp"));
    const notArrived = cards.filter((c) => !c.ok);
    check(cards.length > 5 && notArrived.length === 0, `products page on ${label}: all ${cards.length} photos arrive${notArrived.length ? " -> " + notArrived.map((c) => c.src).join(", ") : ""}`);
    check(notSmall.length === 0, `products page on ${label}: every card takes the small copy${notSmall.length ? " -> " + notSmall.map((c) => c.src).join(", ") : ""}`);
    // The small copy must be enough for the size the card is drawn at.
    const starved = cards.filter((c) => c.drawn * dpr > 480 * 1.15);
    check(starved.length === 0, `products page on ${label}: the small copy is enough for a ${Math.round(cards[0].drawn)} px card`);

    await p.goto(BASE + product, { waitUntil: "networkidle" });
    const main = await p.evaluate(() => { const i = document.querySelector("main .tile img"); return i ? { src: i.currentSrc.split("/").pop().split("?")[0], ok: i.complete && i.naturalWidth > 0, eager: i.loading === "eager", priority: i.getAttribute("fetchpriority") } : null; });
    check(!!main && main.ok && main.eager && main.priority === "high", `product page on ${label}: the photo arrives first (not lazy, high priority)`);
    check(!!main && main.src.endsWith("-480.webp") !== bigOnProductPage, `product page on ${label}: takes the ${bigOnProductPage ? "full photo" : "small copy"} (${main?.src})`);
    await ctx.close();
  }

  // 4. Replaced photos reach returning visitors: the address carries a version, the same one on every photo.
  {
    const page = await (await fetch(BASE + "/products")).text();
    const versions = [...new Set([...page.matchAll(/\/img\/products\/[a-z0-9-]+\.webp(\?v=\d+)?/g)].map((m) => m[1] ?? "none"))];
    check(versions.length === 1 && /^\?v=\d+$/.test(versions[0]), `photo addresses carry one version number (${versions.join(", ")})`);
    const withVersion = await fetch(BASE + `/img/products/${NAMES[0]}-480.webp${versions[0] === "none" ? "" : versions[0]}`);
    check(withVersion.status === 200 && (withVersion.headers.get("content-type") ?? "").includes("image/webp"), "and the site serves a photo at such an address");
  }

  // 5. The tile: a photo sits on a floor that deepens, with a shadow under it. A drawing stays on the flat tile.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage();
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    const look = await p.evaluate(() => {
      const tiles = [...document.querySelectorAll(".tile")].filter((t) => t.querySelector("img"));
      const photo = tiles.map((t) => {
        const shot = t.querySelector(".shot"), img = t.querySelector("img"), r = t.getBoundingClientRect(), s = shot?.getBoundingClientRect();
        return {
          floor: getComputedStyle(t).backgroundImage.includes("linear-gradient"),
          layerShadow: !!shot && getComputedStyle(shot).filter.includes("drop-shadow"),
          imgShadow: getComputedStyle(img).filter !== "none",
          // The shadow's layer covers the tile, so no browser can cut the shadow off inside the tile.
          covers: !!s && Math.abs(s.left - r.left) < 1 && Math.abs(s.top - r.top) < 1 && Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1,
        };
      });
      const drawing = document.querySelector(".tile > svg");
      return { photo, drawing: drawing ? { floor: getComputedStyle(drawing.parentElement).backgroundImage, shadow: getComputedStyle(drawing).filter } : null };
    });
    const bad = look.photo.filter((x) => !x.floor || !x.layerShadow || x.imgShadow || !x.covers);
    check(look.photo.length > 5 && bad.length === 0, `every photo tile (${look.photo.length}) has its floor, and the shadow sits on a layer that covers the whole tile, not on the photo`);
    if (look.drawing) check(look.drawing.floor === "none" && look.drawing.shadow === "none", "a tile with a drawing stays flat, with no shadow");
    await ctx.close();
  }

  await browser.close();
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
