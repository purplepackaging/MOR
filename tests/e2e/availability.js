// Items without a price stay off the site. Run against a build made with the mock Supabase
// running and AVAILABILITY_TTL_SECONDS=2, so pages follow cost changes within seconds.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3123";
const MOCK = process.env.MOCK ?? "http://127.0.0.1:54321";
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, body) => fetch(MOCK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
// What the dashboard does: load a cost, or take one away (null).
const setCosts = (costs) => post("/__test/costs", costs);
const outage = (on) => post("/__test/outage", { on });
const status = async (p) => (await fetch(BASE + p, { redirect: "manual" })).status;
const html = async (p) => (await fetch(BASE + p)).text();
// Pages refresh in the background: the first visit after a change gets the old page and starts the refresh.
async function until(what, test, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await test()) return true;
    if (Date.now() > end) return false;
    await wait(500);
  }
}
const productLinks = (page) => [...new Set([...page.matchAll(/href="\/products\/[a-z-]+\/([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
const footerCategories = (page) => [...(page.match(/<footer[\s\S]*<\/footer>/)?.[0] ?? "").matchAll(/href="\/products\/([a-z-]+)"/g)].map((m) => m[1]);
async function axe(p, label) {
  await p.waitForFunction(() => document.title.trim().length > 0, null, { timeout: 2000 }).catch(() => {});
  await p.addScriptTag({ content: axeSrc });
  const r = await p.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const v = r.violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")}`);
  check(v.length === 0 && !hs, `axe ${label}${v.length ? " -> " + v.join(" | ") : ""}${hs ? " HSCROLL" : ""}`);
}
async function signIn(p, email) {
  await p.goto(BASE + "/account");
  await p.click("text=Email me a code instead");
  await p.fill("#si-email", email);
  await p.click("main form button[type=submit]");
  await p.waitForSelector("#si-code");
  await p.fill("#si-code", "123456");
  await Promise.all([p.waitForURL(/\/account$/), p.click("main form button[type=submit]")]);
}
const setList = (p, lines) => p.evaluate((l) => localStorage.setItem("mor.list.v1", JSON.stringify(l)), lines);
const savedSkus = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("mor.list.v1")).map((l) => l.sku).join());

// The products that have a cost in the mock, by page name. Everything else in the catalog is hidden.
const FOR_SALE = ["bagasse-hinged", "chafing-fuel", "clear-cold-cups", "clear-containers", "cold-cup-dome-lids", "dinner-napkins", "face-masks", "guest-checks", "hinged-foam-free", "hot-cups", "kraft-bags", "kraft-takeout-boxes", "mops-brooms", "portion-cups"];
const CATEGORIES = ["cups-lids", "containers", "foil-wrap", "bags", "napkins-paper", "gloves-safety", "cleaning"];

(async () => {
  // A page refreshes in the background on the first visit after a change, so that visit still gets
  // the old one, and the refresh may still read a list that is up to 2 seconds old. So: let that
  // list age out, give every page one visit, then wait until they all show the mock's starting costs.
  const SETTLED = ["/products", "/", "/sitemap.xml", "/privacy"];
  const settle = async () => {
    await wait(2300);
    await Promise.all(SETTLED.map(html));
    await wait(800);
    return until("pages settle", async () => {
      const [products, home, sitemap, privacy] = await Promise.all(SETTLED.map(html));
      return JSON.stringify(productLinks(products)) === JSON.stringify(FOR_SALE) && home.includes("14 products in 7 categories") && (sitemap.match(/<url>/g) ?? []).length === 104 && footerCategories(privacy).length === CATEGORIES.length;
    });
  };
  await settle();

  // ───── What the pages hold, straight from the server ─────
  let page = await html("/products");
  check(JSON.stringify(productLinks(page)) === JSON.stringify(FOR_SALE), `the products page lists the ${FOR_SALE.length} products that have a price, and no others (${productLinks(page).length} listed)`);
  check(JSON.stringify(footerCategories(page)) === JSON.stringify(CATEGORIES), `the footer lists only categories with something to sell (${footerCategories(page).join(", ")})`);
  page = await html("/");
  check(page.includes("14 products in 7 categories") && !page.includes("Plates &amp; bowls"), `the home page counts only what is for sale (${page.match(/\d+ products in \d+ categories/)?.[0]})`);
  check(page.includes("Dinner napkins") && !/Cutlery kits|Deli containers with lids|Microwavable containers/.test(page), "the home page staples leave out products without a price");
  for (const lang of ["", "/es", "/tr", "/ar"]) {
    const codes = [await status(`${lang}/products/plates-bowls`), await status(`${lang}/products/cups-lids/translucent-cups`), await status(`${lang}/products/cups-lids`), await status(`${lang}/products/cups-lids/clear-cold-cups`)];
    check(codes.join() === "404,404,200,200", `${lang || "/en"}: a category and a product with nothing to sell are not found, the others open (${codes.join()})`);
  }
  page = await html("/products/cups-lids/clear-cold-cups");
  const sizes = [...page.matchAll(/aria-label="Add [^"]*?, ([^"]+?) to (?:your )?list"/g)].map((m) => m[1]);
  // The product's own sizes. "Goes with" below them names the lids that fit, and a lid fits "12–24 oz".
  const ownSizes = page.match(/<section[^>]*aria-labelledby="sizes-title"[\s\S]*?<\/section>/)?.[0] ?? "";
  check(ownSizes.includes("16 oz") && !ownSizes.includes("24 oz") && !ownSizes.includes("32 oz"), `a product page lists only the sizes that have a price ${sizes.length ? `(${sizes.join("; ")})` : ""}`);
  check(page.includes("Dome lids for cold cups") && !page.includes("Flat and sip lids") && !page.includes("Cup carriers") && !page.includes("Straws"), "“Goes with” leaves out products without a price");
  const sitemap = await html("/sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  check(urls.includes("/products/cups-lids/clear-cold-cups") && urls.includes("/ar/products/cleaning/mops-brooms") && !urls.some((u) => /translucent-cups|plates-bowls|cutlery-straws/.test(u)), `the sitemap holds only pages that open (${urls.length} addresses)`);
  const listed = urls.filter((u) => /^\/products\/[a-z-]+\/[a-z0-9-]+$/.test(u)).map((u) => u.split("/").pop()).sort();
  check(JSON.stringify(listed) === JSON.stringify(FOR_SALE), `the sitemap lists each product for sale, and no other product (${listed.length}${listed.length === FOR_SALE.length ? "" : ": " + listed.join(",")})`);

  // ───── A new cost puts the item on the site by itself; taking it away hides it again ─────
  // BPR-9W is one size of "Sugarcane plates, round", in a category that has nothing else for sale.
  await setCosts({ "BPR-9W": 19.5 });
  let ok = await until("plates show", async () => (await status("/products/plates-bowls/bagasse-plates")) === 200 && (await status("/products/plates-bowls")) === 200 && productLinks(await html("/products")).includes("bagasse-plates"));
  check(ok, "a newly loaded cost puts the product page, its category and its card on the site within seconds, with no deploy");
  ok = await until("footer and home follow", async () => footerCategories(await html("/privacy")).includes("plates-bowls") && (await html("/")).includes("15 products in 8 categories") && (await html("/sitemap.xml")).includes("/products/plates-bowls/bagasse-plates"));
  check(ok, "the footer, the home page counts and the sitemap follow");
  page = await html("/products/plates-bowls/bagasse-plates");
  check((page.match(/BPR-[0-9A-Z]+/g) ?? []).every((s) => s === "BPR-9W") && page.includes("BPR-9W"), "only the size with a cost is listed");
  check(await until("es follows", async () => (await status("/es/products/plates-bowls/bagasse-plates")) === 200), "the other languages follow too");
  await setCosts({ "BPR-9W": null });
  ok = await until("plates go", async () => (await status("/products/plates-bowls/bagasse-plates")) === 404 && (await status("/products/plates-bowls")) === 404 && !productLinks(await html("/products")).includes("bagasse-plates") && !footerCategories(await html("/privacy")).includes("plates-bowls"));
  check(ok, "taking the cost away hides the product, its category and the footer link again");

  // ───── Site data fixed on Nov 11: the blue foil sheet, case packs for film, and "1 roll" not "1 rolls" ─────
  await setCosts({ "FSH-9-500B": 20, "FLM-12": 20, "FLM-M18-4": 20 });
  ok = await until("fixed items show", async () => (await status("/products/foil-wrap/food-film")) === 200 && (await status("/products/foil-wrap/foil-sheets")) === 200 && (await status("/ar/products/foil-wrap/food-film")) === 200 && (await status("/es/products/foil-wrap/food-film")) === 200 && (await status("/tr/products/foil-wrap/food-film")) === 200);
  const cells = (page) => [...page.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/[\u2066-\u2069]/g, "").trim());
  let film = cells(await html("/products/foil-wrap/food-film"));
  check(ok && film.includes("1 roll") && film.includes("2 rolls") && !film.includes("1 rolls") && !film.includes("Ask your rep"), `film shows its case packs: 1 roll for the 2,000 ft roll, 2 rolls for meat film (${film.filter((c) => /roll/.test(c)).join("; ")})`);
  const sheet = cells(await html("/products/foil-wrap/foil-sheets"));
  check(sheet.includes("Blue") && !sheet.includes("Black"), `the striped foil sheet is called blue, not black (${sheet.filter((c) => /Blue|Black/.test(c)).join("; ")})`);
  const packs = {};
  for (const lang of ["es", "tr", "ar"]) packs[lang] = cells(await html(`/${lang}/products/foil-wrap/food-film`));
  check(packs.es.includes("1 rollo") && packs.es.includes("2 rollos") && packs.tr.includes("1 rulo") && packs.tr.includes("2 rulo") && packs.ar.includes("لفة واحدة") && packs.ar.includes("لفتان"), `unit words follow the count in every language (es: ${packs.es.filter((c) => /roll/.test(c)).join(", ")}; tr: ${packs.tr.filter((c) => /rulo/.test(c)).join(", ")}; ar: ${packs.ar.filter((c) => /لف/.test(c)).join("، ")})`);
  await setCosts({ "FSH-9-500B": null, "FLM-12": null, "FLM-M18-4": null });

  // ───── The site describes what the supplier ships: green guest checks, 300 ft and 750 ft roll towels ─────
  await setCosts({ "TWL-RT-W": 20, "TWL-HW-B": 20 });
  ok = await until("towels show", async () => (await status("/products/napkins-paper/paper-towels")) === 200);
  const towels = cells(await html("/products/napkins-paper/paper-towels"));
  check(ok && towels.includes("300 ft") && towels.includes("750 ft") && !towels.includes("350 ft") && !towels.includes("800 ft"), `roll towels are 300 ft and 750 ft (${towels.filter((c) => / ft$/.test(c)).join("; ")})`);
  const checks = cells(await html("/products/napkins-paper/guest-checks"));
  check(checks.includes("Green") && !checks.includes("Blue"), `guest checks are green, not blue (${checks.filter((c) => /Green|Blue/.test(c)).join("; ")})`);
  await setCosts({ "TWL-RT-W": null, "TWL-HW-B": null });
  await until("towels hidden again", async () => (await status("/products/napkins-paper/paper-towels")) === 404);
  await until("fixed items hidden again", async () => (await status("/products/foil-wrap/food-film")) === 404 && (await status("/products/foil-wrap/foil-sheets")) === 404 && !productLinks(await html("/products")).includes("food-film"));

  // ───── Supabase out of reach: pages keep their last good version ─────
  await settle();
  await outage(true);
  await wait(2500);
  const during = [];
  for (let i = 0; i < 3; i++) {
    during.push([await status("/"), await status("/products"), await status("/products/cups-lids/clear-cold-cups"), await status("/products/cups-lids/translucent-cups"), await status("/list"), await status("/privacy"), await status("/sitemap.xml")].join());
    await wait(1200);
  }
  check(during.every((d) => d === "200,200,200,404,200,200,200"), `while priced SKUs cannot be read, pages keep answering as before (${[...new Set(during)].join(" / ")})`);
  page = await html("/products");
  check(JSON.stringify(productLinks(page)) === JSON.stringify(FOR_SALE), "and the products page still lists only what was for sale");
  check(JSON.stringify(footerCategories(await html("/privacy"))) === JSON.stringify(CATEGORIES), "and the footer keeps its last list");
  await outage(false);
  await wait(2500);

  // A detail that every size for sale shares is said once, beside the material, and not in a column.
  {
    const head = (text) => [...(text.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "").matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]).join(",");
    const facts = (text) => (text.match(/<ul role="list" class="[^"]*facts[^"]*">[\s\S]*?<\/ul>/)?.[0] ?? "").replace(/<[^>]+>/g, "|");
    const hot = await html("/products/cups-lids/hot-cups"); // 8 oz and 12 oz for sale, both white
    check(head(hot) === "Size,Per case" && /\|White\|/.test(facts(hot)), `two sizes that share a color: the color is a pill and the table keeps Size and Per case (${head(hot)})`);
    const boxes = await html("/products/containers/kraft-takeout-boxes"); // No. 1 and No. 8, both kraft
    check(head(boxes) === "Item,Size,Per case" && /\|Kraft\|/.test(facts(boxes)), `the same on a product with two columns left (${head(boxes)})`);
    const cup = await html("/products/cups-lids/clear-cold-cups"); // one size for sale
    check(head(cup) === "Size,Lid size,Per case" && !/98 mm/.test(facts(cup)), `one size for sale keeps its columns, and a cup's "fits" is headed Lid size (${head(cup)})`);
    const ar = await html("/ar/products/cups-lids/hot-cups");
    check(/<bdi>أبيض<\/bdi>/.test(ar) && !/<th scope="col">اللون<\/th>/.test(ar), "in Arabic too: the shared color is a pill and there is no color column");
    // A size in another color comes on sale: the color is a choice again, so the column is back.
    await setCosts({ "HOT-08J": 30 });
    const back = await until("color column", async () => head(await html("/products/cups-lids/hot-cups")) === "Size,Color,Per case");
    check(back, "when a size in another color goes on sale, the color column comes back");
    await setCosts({ "HOT-08J": null });
    await until("pill again", async () => head(await html("/products/cups-lids/hot-cups")) === "Size,Per case");
  }

  // A long list in a few colors gets a color filter above it: one tap leaves only that color. A short list has none.
  {
    const MORE = ["HMF-55W", "HMF-66W", "HMF-69W", "HMF-88W", "HMF-66B", "HMF-69B", "HMF-88B"]; // with HMF-993W: 5 white, 3 black
    const boxes = "/products/containers/hinged-foam-free";
    check(!(await html(boxes)).includes("<fieldset") && !(await html("/products/cups-lids/hot-cups")).includes("<fieldset"), "a short list of sizes has no color filter");
    await setCosts(Object.fromEntries(MORE.map((sku) => [sku, 20])));
    const ok = await until("eight foam-free containers", async () => (await html(boxes)).includes("HMF-88B"));
    const b3 = await chromium.launch();
    const pg = await b3.newPage({ viewport: { width: 390, height: 844 } });
    await pg.goto(BASE + boxes, { waitUntil: "networkidle" });
    const rows = () => pg.evaluate(() => [...document.querySelectorAll("main section[aria-labelledby='sizes-title'] tbody tr")].filter((tr) => getComputedStyle(tr).display !== "none").length);
    const choices = await pg.evaluate(() => [...document.querySelectorAll("main fieldset label")].map((l) => l.innerText.trim()).join(","));
    const all = await rows();
    await pg.click("main fieldset label:has-text('Black')");
    const black = await rows();
    await pg.click("main fieldset label:has-text('White')");
    const white = await rows();
    await axe(pg, "390 product page with the color filter on White");
    await pg.click("main fieldset label:has-text('All')");
    const again = await rows();
    check(ok && choices === "All,White,Black" && all === 8 && black === 3 && white === 5 && again === 8, `eight sizes in two colors get a color filter (${choices}): ${all} rows, Black leaves ${black}, White ${white}, All ${again}`);
    const pills = await pg.evaluate(() => [...document.querySelectorAll("main fieldset label span")].map((el) => Math.round(el.getBoundingClientRect().height)));
    check(pills.every((h) => h >= 44), `each color choice is ${Math.min(...pills)} px tall or more`);
    await b3.close();
    await setCosts(Object.fromEntries(MORE.map((sku) => [sku, null])));
    await until("one foam-free container again", async () => !(await html(boxes)).includes("HMF-88B"));
  }

  // A row whose first column is empty (plain film beside meat film): a dash in the table, and on phones the
  // next value is the row's title, never "–".
  {
    await setCosts({ "FLM-12": 20, "FLM-M18-4": 30 });
    const film = "/products/foil-wrap/food-film";
    const ok = await until("food film", async () => (await status(film)) === 200 && /FLM-M18-4|Meat film/.test(await html(film)));
    const b2 = await chromium.launch();
    const rows = {};
    for (const width of [1280, 390]) {
      const pg = await b2.newPage({ viewport: { width, height: 900 } });
      await pg.goto(BASE + film, { waitUntil: "networkidle" });
      rows[width] = await pg.evaluate(() => [...document.querySelectorAll("main tbody tr")].map((tr) => {
        const first = tr.querySelector("td");
        return [...first.querySelectorAll("bdi")].filter((b) => getComputedStyle(b).display !== "none").map((b) => b.innerText.trim()).join(" ");
      }));
      await pg.close();
    }
    await b2.close();
    check(ok && rows[1280].join("|") === "–|Meat film", `food film at 1280 px: the Item column reads ${rows[1280].join(", ")}`);
    check(rows[390].join("|") === "12 in × 2,000 ft|Meat film", `food film at 390 px: each row's title is a value, not a dash (${rows[390].join(", ")})`);
    await setCosts({ "FLM-12": null, "FLM-M18-4": null });
    await until("film hidden", async () => (await status(film)) === 404);
  }

  // The language menu and the current-page mark. English is served at the root, but a page built ahead
  // of time knows itself as /en/...: that must not end up inside a link to another language.
  const header = (text) => text.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  for (const [where, bare] of [["/", ""], ["/products", "/products"], ["/products/cups-lids", "/products/cups-lids"], ["/products/cups-lids/clear-cold-cups", "/products/cups-lids/clear-cold-cups"], ["/es/products", "/products"], ["/ar/products/cups-lids/clear-cold-cups", "/products/cups-lids/clear-cold-cups"], ["/list", "/list"]]) {
    const links = [...header(await html(where)).matchAll(/<a href="([^"]+)" hrefLang="[^"]+" lang="([a-z]{2})/g)].map((m) => `${m[2]} ${m[1]}`);
    const wanted = ["en", "es", "tr", "ar"].map((l) => `${l} /${l}${bare}`);
    const wrong = [...new Set(links)].filter((l) => !wanted.includes(l));
    check(links.length === 8 && wrong.length === 0, `${where}: the language menu links to this same page in each language${wrong.length ? " -> " + wrong.join(", ") : ` (${links.length} links)`}`);
  }
  {
    const codes = [];
    for (const l of ["/es/products/cups-lids/clear-cold-cups", "/tr/products", "/ar"]) codes.push(await status(l));
    const en = await fetch(BASE + "/en/products", { redirect: "manual" });
    check(codes.join() === "200,200,200" && en.status === 307 && new URL(en.headers.get("location"), BASE).pathname === "/products", `those links open: ${codes.join()}, and /en/products goes to /products (${en.status})`);
    const navCurrent = (text) => /<a class="[^"]*navLink[^"]*" aria-current="page" href="[^"]*\/products"/.test(header(text));
    check(navCurrent(await html("/products")) && navCurrent(await html("/products/cups-lids/clear-cold-cups")) && navCurrent(await html("/es/products")) && !navCurrent(await html("/")), "the menu marks Products as the current page in English too, and not on the home page");
  }

  // ───── In the browser ─────
  const b = await chromium.launch();
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp });
    // Routing every request switches the browser's own cache off. With it on, Chromium re-checks cached
    // pages in the background ("stale-while-revalidate", which `next start` sends and Vercel does not),
    // and Playwright never sees those re-checks finish, so waiting for the network to go quiet hangs.
    await ctx.route("**/*", (route) => route.continue());
    await ctx.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    const p = await ctx.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    const blocked = []; p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) blocked.push(m.text().slice(0, 160)); });
    const tag = vp.width;
    await settle();

    // Search finds nothing for a product that is hidden.
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    await p.fill("#product-search", "sushi");
    await p.waitForSelector("text=No products match");
    check(true, `${tag} searching for a hidden product finds nothing`);
    await p.fill("#product-search", "napkins");
    await p.waitForFunction(() => document.querySelectorAll("main ul[role=list] a[href*='/products/']").length > 0);
    const found = await p.evaluate(() => [...document.querySelectorAll("main a[href*='/products/napkins-paper/']")].map((a) => a.getAttribute("href").split("/").pop()));
    // The search also reads the category name, so both products for sale in "Napkins & paper" match. The five hidden ones do not.
    check(found.join() === "dinner-napkins,guest-checks", `${tag} search finds only products for sale (${found.join()})`);
    await axe(p, `${tag} products page with items hidden`);
    // Choosing another language from an English page lands on the same page in that language, and back.
    {
      await p.goto(BASE + "/products/cups-lids", { waitUntil: "networkidle" });
      const pick = async (lang) => {
        if (tag === 390) await p.click("header button[aria-controls][aria-label='Menu'], header button[aria-label='Menú'], header button[aria-label='Menü']").catch(() => {});
        else await p.click("header button[aria-label^='Language'], header button[aria-label^='Idioma'], header button[aria-label^='Dil']");
        const link = p.locator(`header a[lang="${lang}"]:visible`).first();
        await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/en")), link.click()]);
        await p.waitForLoadState("networkidle");
      };
      await pick("es-US");
      const es = { url: new URL(p.url()).pathname, lang: await p.evaluate(() => document.documentElement.lang), h1: await p.textContent("h1") };
      await pick("en-US");
      const en = { url: new URL(p.url()).pathname, lang: await p.evaluate(() => document.documentElement.lang) };
      check(es.url === "/es/products/cups-lids" && es.lang.startsWith("es") && en.url === "/products/cups-lids" && en.lang.startsWith("en"), `${tag} choosing Español on an English page opens the same page in Spanish, and English brings it back (${es.url} "${(es.h1 ?? "").trim()}", then ${en.url})`);
    }
    if (tag === 1280) await p.screenshot({ path: path.join(SHOTS, "hide-products-1280.png"), fullPage: true });
    else await p.screenshot({ path: path.join(SHOTS, "hide-products-390.png"), fullPage: true });

    // A hidden product's address shows the site's own "not found" page.
    await p.goto(BASE + "/products/cups-lids/translucent-cups");
    check((await p.textContent("main")).toLowerCase().includes("couldn") && (await p.$("main a[href='/products']")) !== null, `${tag} a hidden product's address shows the not-found page, with a way back to products`);
    const notFoundTitle = async () => { await p.waitForFunction(() => document.title.includes("couldn’t find"), null, { timeout: 3000 }).catch(() => {}); return p.title(); };
    check((await notFoundTitle()).includes("couldn’t find"), `${tag} and the tab's title says so too (${await p.title()})`);
    await p.goto(BASE + "/products/plates-bowls");
    check((await notFoundTitle()).includes("couldn’t find"), `${tag} the same for a category with nothing to sell (${await p.title()})`);
    await p.goto(BASE + "/products/cups-lids/translucent-cups");
    await axe(p, `${tag} not-found page for a hidden product`);

    // A list saved before the item was hidden: the line comes off, with a note, and nothing jumps.
    await setList(p, [{ sku: "CUP-PET-16", cases: 4 }, { sku: "KFT-1K", cases: 1 }, { sku: "HBG-96N", cases: 2 }]);
    await p.goto(BASE + "/list", { waitUntil: "networkidle" });
    await p.waitForTimeout(300);
    let text = await p.textContent("main");
    check(text.includes("Some items are not available right now. We took them off your list.") && text.includes("2 items") && !text.includes("Paper food trays"), `${tag} signed out: a hidden item comes off the list, with a note`);
    check((await savedSkus(p)) === "CUP-PET-16,HBG-96N", `${tag} and off the saved list (${await savedSkus(p)})`);
    const shift = await p.evaluate(() => Math.round(window.__shift * 1000) / 1000);
    check(shift < 0.01, `${tag} the note shows without the page jumping (layout shift ${shift})`);
    const badge = await p.evaluate(() => document.querySelector("header a[href='/list']")?.textContent ?? "");
    check(badge.includes("2"), `${tag} the header count follows (${badge.trim()})`);
    await axe(p, `${tag} list with the note`);
    await p.screenshot({ path: path.join(SHOTS, `hide-list-note-${tag}.png`), fullPage: true });
    // Every line hidden: the empty list, still with the note.
    await setList(p, [{ sku: "KFT-1K", cases: 1 }, { sku: "CUP-PET-24", cases: 3 }]);
    await p.goto(BASE + "/list", { waitUntil: "networkidle" });
    text = await p.textContent("main");
    check(text.includes("Your list is empty") && text.includes("Some items are not available right now"), `${tag} a list of only hidden items shows as empty, with the note`);
    await axe(p, `${tag} empty list with the note`);
    // Arabic
    await setList(p, [{ sku: "CUP-PET-16", cases: 1 }, { sku: "KFT-1K", cases: 1 }]);
    await p.goto(BASE + "/ar/list", { waitUntil: "networkidle" });
    check((await p.getAttribute("html", "dir")) === "rtl" && (await p.textContent("main")).includes("غير متوفرة حاليًا"), `${tag} the note in Arabic`);
    await axe(p, `${tag} Arabic list with the note`);
    if (tag === 390) await p.screenshot({ path: path.join(SHOTS, "hide-list-note-ar-390.png"), fullPage: true });
    for (const [lang, words] of [["es", "no están disponibles"], ["tr", "mevcut değil"]]) {
      await setList(p, [{ sku: "CUP-PET-16", cases: 1 }, { sku: "KFT-1K", cases: 1 }]);
      await p.goto(`${BASE}/${lang}/list`, { waitUntil: "networkidle" });
      check((await p.textContent("main")).includes(words), `${tag} the note in ${lang}`);
    }
    await p.goto(BASE + "/en/list"); // back to English

    // Signed in. A usual order and a past order that hold an item which later goes off sale.
    await signIn(p, "owner@kebab.test");
    await setList(p, [{ sku: "CUP-PET-16", cases: 2 }, { sku: "GCK-1", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    await p.click("text=Save as my usual order");
    await p.waitForSelector("text=Saved as your usual order");
    await p.click("aside button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    const first = Number((await p.textContent("h2")).match(/\d+/)[0]);
    await setCosts({ "GCK-1": null }); // Guest checks lose their cost
    await p.goto(BASE + "/account");
    ok = await until("usual marks it", async () => { await p.reload(); return (await p.textContent("#usual-title >> xpath=..")).includes("Not available right now"); });
    check(ok, `${tag} the usual order marks the item that is not for sale`);
    await axe(p, `${tag} account page with an item marked`);
    if (tag === 390) await p.screenshot({ path: path.join(SHOTS, "hide-account-390.png"), fullPage: true });
    await setList(p, []);
    await p.click("text=Order my usual");
    await p.waitForURL(/\/list$/);
    await p.waitForSelector("text=Ordering for Kebab House");
    check((await savedSkus(p)) === "CUP-PET-16", `${tag} “Order my usual” adds only what is for sale (${await savedSkus(p)})`);
    await p.goto(`${BASE}/account/orders/${first}`);
    text = await p.textContent("main");
    check(text.includes("Guest check books") && text.includes("Not available right now"), `${tag} the past order keeps the line and marks it`);
    await axe(p, `${tag} order page with an item marked`);
    await setList(p, []);
    await p.click("text=Order these again");
    await p.waitForURL(/\/list$/);
    check((await savedSkus(p)) === "CUP-PET-16", `${tag} “Order these again” adds only what is for sale (${await savedSkus(p)})`);
    await setCosts({ "GCK-1": 18 });
    await until("guest checks back", async () => (await status("/products/napkins-paper/guest-checks")) === 200 && productLinks(await html("/products")).includes("guest-checks"));

    // The page still shows an item that went off sale a moment ago: the order is held back, nothing is placed.
    await setList(p, [{ sku: "CUP-PET-16", cases: 2 }, { sku: "MSK-BL", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    check((await p.textContent("main")).includes("Disposable face masks"), `${tag} the list shows both items`);
    const ordersBefore = await p.evaluate(async () => (await (await fetch("/account/orders")).text()).match(/\/account\/orders\/\d+/g)?.length ?? 0);
    await setCosts({ "MSK-BL": null });
    await p.click(tag === 390 && (await p.$("[data-order-bar] button")) ? "[data-order-bar] button" : "aside button:has-text('Place order')");
    await p.waitForSelector("text=Some items are not available right now");
    check((await p.$("text=/Order \\d+ is in/")) === null && (await savedSkus(p)) === "CUP-PET-16", `${tag} an item that just went off sale holds the order back and comes off the list (${await savedSkus(p)})`);
    check(await p.evaluate(() => document.activeElement?.getAttribute("role") === "status" && document.activeElement.textContent.includes("not available")), `${tag} focus moves to the note`);
    const ordersAfter = await p.evaluate(async () => (await (await fetch("/account/orders")).text()).match(/\/account\/orders\/\d+/g)?.length ?? 0);
    check(ordersAfter === ordersBefore, `${tag} no order was placed (${ordersBefore} before, ${ordersAfter} after)`);
    await axe(p, `${tag} list after an order was held back`);
    // Saving the usual order from a stale page is held back the same way.
    await setCosts({ "MSK-BL": 12 });
    await until("masks back", async () => (await status("/products/gloves-safety/face-masks")) === 200);
    await setList(p, [{ sku: "CUP-PET-16", cases: 2 }, { sku: "MSK-BL", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    await until("masks on the list page", async () => { await p.reload(); await p.waitForSelector("text=Ordering for Kebab House"); return (await p.textContent("main")).includes("Disposable face masks"); });
    await setCosts({ "MSK-BL": null });
    await p.click("text=Save as my usual order");
    await p.waitForSelector("text=Some items are not available right now");
    check((await p.$("text=Saved as your usual order")) === null && (await savedSkus(p)) === "CUP-PET-16", `${tag} saving a usual order with an item that just went off sale is held back too`);
    // What is left can be ordered.
    await p.click("aside button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    text = await p.textContent("main");
    check(text.includes("Clear cold cups") && !text.includes("face masks") && text.includes("$156.66"), `${tag} the rest of the list orders as usual (2 x 53.33 + 50 = 156.66)`);
    await setCosts({ "MSK-BL": 12 });
    await until("masks back", async () => (await status("/products/gloves-safety/face-masks")) === 200);

    // Supabase cannot say what is for sale: ordering what the page shows still works.
    await setList(p, [{ sku: "HBG-96N", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    await outage(true);
    await p.click("aside button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    check(true, `${tag} an order still goes through while the priced SKU list cannot be read`);
    await outage(false);

    check(errors.length === 0, `${tag} no page errors ${errors.join(" | ")}`);
    check(blocked.length === 0, `${tag} the content security policy blocked nothing ${blocked.join(" | ")}`);
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})();
