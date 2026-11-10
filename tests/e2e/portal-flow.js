const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3123";
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
let fails = 0;
const check = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
async function axe(p, label) {
  // Next can swap <title> while a form action settles. Give it a moment; a title that never comes still fails below.
  await p.waitForFunction(() => document.title.trim().length > 0, null, { timeout: 2000 }).catch(() => {});
  await p.addScriptTag({ content: axeSrc });
  const r = await p.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const v = r.violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")}`);
  check(v.length === 0 && !hs, `axe ${label}${v.length ? " -> " + v.join(" | ") : ""}${hs ? " HSCROLL" : ""}`);
}
async function signIn(p, email, landing = /\/account$/) {
  await p.goto(BASE + "/account");
  await p.fill("#si-email", email);
  await p.click("button[type=submit]");
  await p.waitForSelector("#si-code");
  await p.fill("#si-code", "123456");
  await Promise.all([p.waitForURL(landing), p.click("form button[type=submit]")]);
}
async function signOut(p) {
  await p.goto(BASE + "/account");
  await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.click("button:has-text('Sign out')")]);
}
const LIST = [{ sku: "CUP-PET-16", cases: 4 }, { sku: "HBG-96N", cases: 2 }, { sku: "KFT-1K", cases: 1 }];
// Four priced lines: 2 x 53.33 + 40.00 + 44.44 + 3 x 33.33 = 291.09, plus 50 delivery = 341.09.
const PRICED = [{ sku: "CUP-PET-16", cases: 2 }, { sku: "LID-DOME-98H", cases: 1 }, { sku: "HBG-96N", cases: 1 }, { sku: "POR-020C", cases: 3 }];
const setList = (p, lines) => p.evaluate((l) => localStorage.setItem("mor.list.v1", JSON.stringify(l)), lines);
// A static product page: CUP-PET-16 (16 oz) has a cost in the mock, the other sizes do not.
const PRODUCT = "/products/cups-lids/clear-cold-cups";
const visibleText = (p) => p.evaluate(() => document.querySelector("main").innerText);
const addButtons = (p) => p.evaluate(() => [...document.querySelectorAll("tbody tr button")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top + scrollY)]; }));
const orderBar = async (p) => ((await p.$("[data-order-bar]")) ? (await p.innerText("[data-order-bar]")).replace(/\s+/g, " ") : null);

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp });
    const p = await ctx.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    const tag = vp.width;

    // Product page, signed out: no prices. Keep where the Add buttons are, to compare once prices show.
    await p.goto(BASE + PRODUCT, { waitUntil: "networkidle" });
    let productText = await visibleText(p);
    check(productText.includes("Prices show after you sign in") && !productText.includes("$"), `${tag} signed-out product page shows no prices`);
    const addsBefore = await addButtons(p);

    // Sign-in page and redirect
    await p.goto(BASE + "/account");
    check(p.url().includes("/account/sign-in?next=%2Faccount"), `${tag} /account sends signed-out visitors to sign-in`);
    check((await p.textContent("main")).includes("The same code creates your account"), `${tag} sign-in says new emails get an account`);
    await axe(p, `${tag} sign-in`);
    // Bad email
    await p.fill("#si-email", "not-an-email"); await p.click("button[type=submit]");
    await p.waitForSelector("#si-email-error");
    check((await p.textContent("#si-email-error")).includes("name@example.com"), `${tag} bad email message`);
    // A new email gets a code too (open sign-up)
    await p.fill("#si-email", `stranger${tag}@nowhere.test`); await p.click("button[type=submit]");
    await p.waitForSelector("#si-code");
    check((await p.textContent("main")).includes(`We sent a code to stranger${tag}@nowhere.test`), `${tag} new email gets a code`);
    await axe(p, `${tag} code step`);
    await p.fill("#si-code", "000000"); await p.click("form button[type=submit]");
    await p.waitForSelector("#si-code-error");
    check((await p.textContent("#si-code-error")).includes("didn’t work"), `${tag} wrong code message`);
    await p.click("text=Use a different email");
    await p.waitForSelector("#si-email");

    // Existing customer
    await p.fill("#si-email", "owner@kebab.test"); await p.click("button[type=submit]");
    await p.waitForSelector("#si-code");
    await p.fill("#si-code", "123456");
    await Promise.all([p.waitForURL(/\/account$/), p.click("form button[type=submit]")]);
    check((await p.textContent("h1")) === "Kebab House", `${tag} account page shows the business`);
    check((await p.textContent("main")).includes("Delivery day: Thursday"), `${tag} delivery day pill`);
    check((await p.textContent("main")).includes("Your prices show on product pages"), `${tag} priced account message`);
    if (tag === 1280) {
      await p.waitForTimeout(400);
      check((await p.textContent("header")).includes("Your account"), `${tag} header switches to Your account`);
      check(!(await p.textContent("header")).includes("Create account"), `${tag} header hides Create account once signed in`);
    }
    await axe(p, `${tag} account home (empty)`);

    // Product page, signed in: this customer's price per case beside each size
    await p.goto(BASE + PRODUCT);
    await p.waitForFunction(() => document.querySelector("main").innerText.includes("$53.33"));
    productText = await visibleText(p);
    check(productText.includes("To be confirmed"), `${tag} product page shows the price per case, and marks sizes without one`);
    check(!productText.includes("Prices show after you sign in"), `${tag} product page drops the sign-in line for customers`);
    const priceIn = await p.evaluate(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].some((el) => getComputedStyle(el).display !== "none");
      return { column: shown('td[class*="priceCell"]'), caseLine: shown('span[class*="priceInline"]') };
    });
    check(tag === 1280 ? priceIn.column && !priceIn.caseLine : priceIn.caseLine && !priceIn.column, `${tag} price shows ${tag === 1280 ? "in its own column" : "on the case line"}`);
    check(JSON.stringify(await addButtons(p)) === JSON.stringify(addsBefore), `${tag} Add buttons do not move when prices arrive`);
    await axe(p, `${tag} product page signed in`);
    for (const [lang, label, price] of [["es", "Precio por caja", "$53.33"], ["tr", "Koli fiyatı", "$53,33"], ["ar", "سعر الكرتونة", "$53.33"]]) {
      await p.goto(`${BASE}/${lang}${PRODUCT}`);
      await p.waitForFunction((x) => document.querySelector("main").innerText.includes(x), price);
      check((await visibleText(p)).includes(label), `${tag} ${lang} product page shows the price per case (${price})`);
      if (lang === "ar") await axe(p, `${tag} Arabic product page signed in`);
    }
    await p.goto(BASE + "/en/account"); // back to English (the switcher path resets the language cookie)

    // List: prices at a 25% margin, delivery fee, next-day option, card fee note
    await setList(p, LIST);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    let listText = await p.textContent("main");
    check(listText.includes("$53.33 a case") && listText.includes("$44.44 a case") && listText.includes("To be confirmed"), `${tag} per-case prices (cost / 0.75) and unpriced item on the list`);
    check(listText.includes("$213.32") && listText.includes("$88.88"), `${tag} each priced line shows what it comes to (4 x 53.33 = 213.32, 2 x 44.44 = 88.88)`);
    check(listText.includes("$302.20"), `${tag} subtotal of priced lines (4 x 53.33 + 2 x 44.44 = 302.20)`);
    check(listText.includes("Delivery") && listText.includes("$50.00"), `${tag} delivery fee shown before ordering`);
    check(listText.includes("Paying by credit card adds 3%"), `${tag} card fee note`);
    check(!listText.includes("$352.20"), `${tag} no total while an item has no price`);
    if (tag === 390) {
      await p.waitForSelector("[data-order-bar]");
      const bar = await orderBar(p);
      check(bar.includes("To be confirmed") && bar.includes("Place order") && !bar.includes("$"), `${tag} order bar gives no total while an item has no price (${bar})`);
    } else {
      check((await orderBar(p)) === null, `${tag} no order bar when the summary sits beside the list`);
    }
    await axe(p, `${tag} list signed in`);
    await p.check("text=Next-day delivery, +$50.00");
    listText = await p.textContent("aside");
    check((listText.match(/\$50\.00/g) ?? []).length >= 3, `${tag} next-day fee line appears when ticked`);
    await p.click("text=Save as my usual order");
    await p.waitForSelector("text=Saved as your usual order");
    check(true, `${tag} usual order saved`);
    await p.fill("#order-note", "Back door, before 10 am");
    await p.click("button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    const placed = await p.textContent("h2");
    check(/Order 10\d\d is in/.test(placed), `${tag} order placed: ${placed}`);
    check(await p.evaluate(() => JSON.parse(localStorage.getItem("mor.list.v1")).length === 0), `${tag} list cleared after ordering`);
    await axe(p, `${tag} order placed`);
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    let orderText = await p.textContent("main");
    check(orderText.includes("Back door, before 10 am") && orderText.includes("Received") && orderText.includes("$213.32"), `${tag} order page shows note, status and line totals`);
    check(orderText.includes("Next-day delivery") && orderText.includes("$50.00") && orderText.includes("Delivery"), `${tag} order page shows delivery and next-day fees`);
    await axe(p, `${tag} order page`);
    await p.click("text=Order these again");
    await p.waitForURL(/\/list$/);
    check(await p.evaluate(() => JSON.parse(localStorage.getItem("mor.list.v1")).length === 3), `${tag} reorder puts 3 lines on the list`);

    // A longer, fully priced list: the 999-case limit, 44 px steppers, the spoken total, and the order bar on phones
    await setList(p, PRICED);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    const qty = p.locator("input[aria-label^='Cases of Clear cold cups']");
    await qty.fill("5000");
    await qty.press("Enter");
    await p.waitForSelector("text=Up to 999 cases per item.");
    check((await qty.inputValue()) === "999", `${tag} typing 5000 cases says the limit and sets 999`);
    await qty.fill("2");
    await qty.press("Enter");
    const step = await p.evaluate(() => { const r = document.querySelector("button[aria-label^='One case more of']").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    check(step[0] >= 44 && step[1] >= 44, `${tag} stepper buttons are ${step.join(" x ")} px`);
    if (tag === 390) {
      await p.evaluate(() => scrollTo(0, 0));
      await p.waitForFunction(() => document.querySelector("[data-order-bar]")?.innerText.includes("$341.09"));
      const bar = await orderBar(p);
      check(bar.includes("Total with delivery") && bar.includes("Place order"), `${tag} order bar shows the total with delivery (${bar})`);
    }
    await p.click("button[aria-label^='One case more of Clear cold cups']");
    await p.waitForFunction(() => document.querySelector("aside [role=status]")?.textContent.includes("$394.42"));
    check((await p.textContent("aside [role=status]")).includes("4 items. 8 cases."), `${tag} screen readers hear the new count and total (${await p.textContent("aside [role=status]")})`);
    if (tag === 390) {
      check((await orderBar(p)).includes("$394.42"), `${tag} order bar follows the list (3 x 53.33 + 40.00 + 44.44 + 99.99 + 50 = 394.42)`);
      await p.evaluate(() => document.querySelector("aside button.btn").scrollIntoView({ block: "center" }));
      await p.waitForSelector("[data-order-bar]", { state: "detached" });
      await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await p.waitForTimeout(300);
      check((await orderBar(p)) === null, `${tag} order bar leaves once the summary's own button is in view, and stays away below it`);
      await p.evaluate(() => scrollTo(0, 0));
      await p.waitForSelector("[data-order-bar]");
      await p.click("[data-order-bar] button");
    } else {
      await p.click("aside button:has-text('Place order')");
    }
    await p.waitForSelector("text=/Order \\d+ is in/");
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    check((await p.textContent("main")).includes("$394.42"), `${tag} order placed from ${tag === 390 ? "the order bar" : "the summary"} keeps the total`);

    // Fully priced order: the total adds the delivery fee
    await setList(p, [{ sku: "CUP-PET-16", cases: 2 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    check((await p.textContent("aside")).includes("$156.66"), `${tag} total on the list (2 x 53.33 + 50 = 156.66)`);
    await p.click("button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    orderText = await p.textContent("main");
    check(orderText.includes("$156.66") && !orderText.includes("Next-day delivery"), `${tag} order total saved, standard delivery`);

    await p.goto(BASE + "/account");
    const home = await p.textContent("main");
    check(home.includes("Recent orders") && /10\d\d/.test(home) && home.includes("Saved") && home.includes("$156.66"), `${tag} account home lists usual order and orders with totals`);
    await axe(p, `${tag} account home (filled)`);
    await p.goto(BASE + "/account/orders");
    await axe(p, `${tag} order history`);
    await p.goto(BASE + "/ar/account");
    check((await p.getAttribute("html", "dir")) === "rtl" && (await p.textContent("main")).includes("يوم التوصيل"), `${tag} Arabic account page`);
    await axe(p, `${tag} Arabic account`);
    await p.goto(BASE + "/en/account"); // back to English (the switcher path resets the language cookie)
    await p.goto(BASE + "/account/orders/999999");
    check((await p.textContent("h1")).length > 0 && (await p.textContent("main")).toLowerCase().includes("couldn"), `${tag} unknown order number is a 404`);
    if (tag === 1280) {
      // Prices stay in the page's memory from one product page to the next. Signing out must drop them, with no reload in between.
      await p.goto(BASE + PRODUCT);
      await p.waitForFunction(() => document.querySelector("main").innerText.includes("$53.33"));
      await p.evaluate(() => { window.__sameDocument = true; });
      // Hold sign-in checks back, so only prices already in memory can show.
      const slow = async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); };
      await p.route("**/api/session", slow);
      await Promise.all([p.waitForURL((u) => u.pathname.endsWith("/cold-cup-dome-lids")), p.click("main a:has-text('Dome lids for cold cups')")]);
      await p.waitForSelector("h1:has-text('Dome lids for cold cups')");
      check((await visibleText(p)).includes("$40.00"), `${tag} the next product page shows prices at once, from memory`);
      await p.unroute("**/api/session", slow);
      await Promise.all([p.waitForURL(/\/account$/), p.click("header a:has-text('Your account')")]);
      await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.click("button:has-text('Sign out')")]);
      await p.waitForFunction(() => document.querySelector("header").innerText.includes("Sign in"));
      await p.route("**/api/session", slow);
      await Promise.all([p.waitForURL(/\/products$/), p.click("header a:has-text('Products')")]);
      await Promise.all([p.waitForURL((u) => u.pathname === PRODUCT), p.click("main a:has-text('Clear cold cups')")]);
      await p.waitForSelector("h1:has-text('Clear cold cups')");
      const kept = await p.evaluate(() => window.__sameDocument === true);
      check(kept && !(await visibleText(p)).includes("$"), `${tag} prices held in memory go at sign-out (same page load: ${kept})`);
      await p.unroute("**/api/session", slow);
    } else {
      await signOut(p);
    }
    await p.goto(BASE + "/account");
    check(p.url().includes("/account/sign-in"), `${tag} signed out`);

    // Signed out, the list asks people to sign in to order
    await setList(p, [{ sku: "CUP-PET-16", cases: 1 }]);
    await p.goto(BASE + "/list");
    check((await p.textContent("aside")).includes("Sign in to order") && !(await p.textContent("main")).includes("$"), `${tag} signed-out list asks to sign in, no prices`);
    if (tag === 390) {
      await setList(p, PRICED);
      await p.goto(BASE + "/list");
      await p.waitForSelector("[data-order-bar] a");
      const bar = await orderBar(p);
      check(bar.includes("4 items") && bar.includes("Sign in to order") && !bar.includes("$"), `${tag} signed-out order bar counts the list and asks to sign in (${bar})`);
    }

    // Open sign-up: new email, then the business form, then ordering
    const chef = `chef${tag}@new.test`;
    await signIn(p, chef, /\/account\/setup/);
    check(p.url().includes("/account/setup?next=%2Faccount"), `${tag} first sign-in goes to the business form`);
    check((await p.textContent("main")).includes(`Signed in as ${chef}`), `${tag} business form shows the email`);
    await axe(p, `${tag} business form`);
    await p.click("button:has-text('Start ordering')");
    await p.waitForSelector("#su-businessName-error");
    check((await p.textContent("#su-businessName-error")).includes("Enter your business name"), `${tag} business form explains missing fields`);
    check(await p.evaluate(() => document.activeElement?.id === "su-businessName"), `${tag} focus moves to the first problem`);
    await axe(p, `${tag} business form errors`);
    await p.fill("#su-businessName", "Pho Place");
    await p.fill("#su-street", "1 Peachtree St");
    await p.fill("#su-city", "Atlanta");
    await p.fill("#su-zip", "30303");
    await p.fill("#su-contactName", "Linh");
    await p.fill("#su-phone", "404 555 0123");
    await p.check("#su-sms");
    await Promise.all([p.waitForURL(/\/account$/), p.click("button:has-text('Start ordering')")]);
    check((await p.textContent("h1")) === "Pho Place", `${tag} new account is ready right away`);
    check((await p.textContent("main")).includes("Your prices show on product pages"), `${tag} new account sees prices`);
    await setList(p, [{ sku: "HBG-96N", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Pho Place");
    check((await p.textContent("main")).includes("$44.44 a case") && (await p.textContent("aside")).includes("$94.44"), `${tag} new account can order at the same prices`);
    await signOut(p);

    // /request-account now starts sign-up
    await p.goto(BASE + "/request-account");
    await p.waitForSelector("#si-email");
    check(p.url().includes("/account/sign-in?new=1") && (await p.textContent("h1")) === "Create your account", `${tag} request page opens account creation`);

    // A crafted "next" never sends people to another site after they sign in.
    // Browsers drop tabs and line breaks from URLs and read "\" as "/", so each of these would become "//example.com".
    const site = new URL(BASE).origin;
    for (const [name, bad] of [["a tab", "/%09/example.com/x"], ["a line feed", "/%0A/example.com/x"], ["a carriage return", "/%0D/example.com/x"], ["a backslash", "/%5Cexample.com/x"], ["two slashes", "//example.com/x"]]) {
      await p.goto(`${BASE}/account/sign-in?next=${bad}`);
      await p.fill("#si-email", "owner@kebab.test");
      await p.click("main form button[type=submit]");
      await p.waitForSelector("#si-code");
      await p.fill("#si-code", "123456");
      await Promise.all([p.waitForURL((u) => !u.pathname.includes("/sign-in")), p.click("main form button[type=submit]")]);
      check(p.url() === `${site}/account`, `${tag} sign-in ignores a next with ${name} (landed on ${p.url()})`);
      // Signed in with a business already: the business form forwards, and must stay on the site too.
      const hop = await p.request.get(`${BASE}/account/setup?next=${bad}`, { maxRedirects: 0 });
      check(hop.status() === 307 && hop.headers()["location"] === "/account", `${tag} business form ignores a next with ${name} (${hop.status()} ${JSON.stringify(hop.headers()["location"])})`);
      await signOut(p);
    }
    // A normal next still works.
    await p.goto(`${BASE}/account/sign-in?next=%2Faccount%2Forders`);
    await p.fill("#si-email", "owner@kebab.test");
    await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await p.fill("#si-code", "123456");
    await Promise.all([p.waitForURL(/\/account\/orders$/), p.click("main form button[type=submit]")]);
    check(p.url() === `${site}/account/orders`, `${tag} sign-in still returns people to the page they came from`);
    await signOut(p);

    // A switched-off account
    await signIn(p, "paused@spot.test");
    check((await p.textContent("h1")).includes("paused"), `${tag} switched-off account sees the paused message`);
    await axe(p, `${tag} paused account`);
    await p.goto(BASE + PRODUCT, { waitUntil: "networkidle" });
    productText = await visibleText(p);
    check(!productText.includes("$") && !productText.includes("Prices show after you sign in"), `${tag} switched-off account sees no prices on product pages`);
    await signOut(p);
    check(errors.length === 0, `${tag} no page errors ${errors.join(" | ")}`);
    if (tag === 1280) {
      // Screenshots for review
      await signIn(p, "owner@kebab.test");
      await p.screenshot({ path: path.join(SHOTS, "portal-account.png"), fullPage: true });
      await setList(p, LIST);
      await p.goto(BASE + "/list"); await p.waitForSelector("text=Ordering for Kebab House");
      await p.check("text=Next-day delivery, +$50.00");
      await p.screenshot({ path: path.join(SHOTS, "portal-list.png"), fullPage: true });
      await p.goto(BASE + "/account/orders");
      await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("table a >> nth=-1")]);
      await p.screenshot({ path: path.join(SHOTS, "portal-order.png"), fullPage: true });
      await signOut(p);
      await signIn(p, `screens${tag}@new.test`, /\/account\/setup/);
      await p.screenshot({ path: path.join(SHOTS, "portal-setup.png"), fullPage: true });
    }
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
})();
