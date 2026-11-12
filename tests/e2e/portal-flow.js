const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3123";
const MOCK = process.env.MOCK ?? "http://127.0.0.1:54321";
// The emails the site sent to the team, as the mock's stand-in for Resend received them.
const teamEmails = async () => (await fetch(MOCK + "/__test/emails")).json();
// The site hides items without a price, as production does. Build and run with SHOW_UNPRICED=true
// to check the other setting, where they show as "To be confirmed".
const HIDE = process.env.SHOW_UNPRICED !== "true";
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
// Sign in with an emailed code. The sign-in page opens on the password form, so ask for the code form first.
async function signIn(p, email, landing = /\/account$/) {
  await p.goto(BASE + "/account");
  await p.click("text=Email me a code instead");
  await p.fill("#si-email", email);
  await p.click("main form button[type=submit]");
  await p.waitForSelector("#si-code");
  await p.fill("#si-code", "123456");
  await Promise.all([p.waitForURL(landing), p.click("main form button[type=submit]")]);
}
// Fill the password form and send it. Resolves once the server has answered.
async function tryPassword(p, email, password) {
  await p.fill("#si-email", email);
  await p.fill("#si-password", password);
  await Promise.all([p.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/account/sign-in")), p.click("main form button[type=submit]")]);
}
async function signInWithPassword(p, email, password, path = "/account/sign-in", landing = /\/account$/) {
  await p.goto(BASE + path);
  await p.fill("#si-email", email);
  await p.fill("#si-password", password);
  await Promise.all([p.waitForURL(landing), p.click("main form button[type=submit]")]);
}
// On the code step: enter the code and, if given, a password, then send.
async function sendCodeStep(p, password, landing) {
  await p.fill("#si-code", "123456");
  if (password != null) await p.fill("#si-new-password", password);
  if (landing) await Promise.all([p.waitForURL(landing), p.click("main form button[type=submit]")]);
  else await Promise.all([p.waitForResponse((r) => r.request().method() === "POST"), p.click("main form button[type=submit]")]);
}
async function signOut(p) {
  await p.goto(BASE + "/account");
  await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.click("button:has-text('Sign out')")]);
}
// KFT-1K has no cost in the mock: hidden by default, "To be confirmed" with SHOW_UNPRICED=true.
const LIST = [{ sku: "CUP-PET-16", cases: 4 }, { sku: "HBG-96N", cases: 2 }, { sku: "KFT-1K", cases: 1 }];
// Four priced lines: 2 x 53.33 + 40.00 + 44.44 + 3 x 33.33 = 291.09, plus 50 delivery = 341.09.
const PRICED = [{ sku: "CUP-PET-16", cases: 2 }, { sku: "LID-DOME-98H", cases: 1 }, { sku: "HBG-96N", cases: 1 }, { sku: "POR-020C", cases: 3 }];
/** The home page by way of the logo: a signed-in customer who types the address lands on their account instead. */
async function openHome(p) {
  if (new URL(p.url()).pathname === "/") return;
  await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.evaluate(() => document.querySelector("header a[href='/']").click())]);
  await p.waitForLoadState("networkidle");
}
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
    // Routing every request switches the browser's own cache off. With it on, Chromium re-checks cached
    // pages in the background ("stale-while-revalidate", which `next start` sends and Vercel does not),
    // and Playwright never sees those re-checks finish, so waiting for the network to go quiet hangs.
    await ctx.route("**/*", (route) => route.continue());
    // Adds up layout shifts on each page load, so a check can ask how far things jumped.
    await ctx.addInitScript(() => {
      window.__shift = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shift += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    const p = await ctx.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    // The browser says so in the console when the content security policy blocks something.
    const blocked = []; p.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) blocked.push(m.text().slice(0, 160)); });
    const tag = vp.width;
    const policy = (await p.request.get(BASE + "/")).headers()["content-security-policy"] ?? "";
    check(policy.includes("default-src 'self'") && policy.includes("frame-ancestors 'none'") && policy.includes("form-action 'self'") && policy.includes("object-src 'none'"), `${tag} pages carry a content security policy (${policy.slice(0, 60)}...)`);

    // A product with no cost in the mock: hidden by default, on show with SHOW_UNPRICED=true.
    const hidden = (await p.request.get(BASE + "/products/cups-lids/translucent-cups")).status();
    check(hidden === (HIDE ? 404 : 200), `${tag} a product without a price is ${HIDE ? "hidden" : "on show, as SHOW_UNPRICED=true asks"} (${hidden})`);

    // Pages fetch another page when someone reaches for its link, not as soon as the link is on screen.
    // Fetching the home page ahead of time used to pull its three photos (325 KB) into every page.
    const fetched = []; const onRequest = (r) => fetched.push(new URL(r.url()).pathname + (r.url().includes("_rsc=") ? " (page data)" : "")); p.on("request", onRequest);
    await p.goto(BASE + "/privacy", { waitUntil: "networkidle" });
    check(!fetched.some((u) => u.startsWith("/img/hero/")) && !fetched.includes("/ (page data)"), `${tag} another page does not download the home page photos (${fetched.filter((u) => u.startsWith("/img/hero/")).length} photos, ${fetched.filter((u) => u === "/ (page data)").length} home page fetches)`);
    await p.hover("header a[href='/']");
    await p.waitForRequest((r) => new URL(r.url()).pathname === "/" && r.url().includes("_rsc="), { timeout: 5000 }).then(() => check(true, `${tag} reaching for the logo fetches the home page ahead of the click`), () => check(false, `${tag} reaching for the logo fetches the home page ahead of the click`));
    fetched.length = 0;
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    const early = fetched.filter((u) => /^\/products\/[a-z-]+(\/[a-z0-9-]+)? \(page data\)$/.test(u));
    check(early.length === 0, `${tag} the products page fetches no product or category page until one is reached for (${early.length} fetched)`);
    await p.hover("main a[href$='/hot-cups']");
    await p.waitForRequest((r) => new URL(r.url()).pathname.endsWith("/hot-cups") && r.url().includes("_rsc="), { timeout: 5000 }).then(() => check(true, `${tag} reaching for a product card fetches that product page`), () => check(false, `${tag} reaching for a product card fetches that product page`));
    await Promise.all([p.waitForURL(/\/products\/cups-lids\/hot-cups$/), p.click("main a[href$='/hot-cups']")]);
    check((await p.textContent("h1")).includes("hot cups"), `${tag} and the card opens it`);
    p.off("request", onRequest);

    // Product cards, signed out: no prices.
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    check((await p.$$("main a[href*='/products/'] span[class*='price']")).length === 0 && !(await visibleText(p)).includes("$"), `${tag} signed-out product cards show no prices`);

    // Product page, signed out: no prices. Keep where the Add buttons are, to compare once prices show.
    await p.goto(BASE + PRODUCT, { waitUntil: "networkidle" });
    let productText = await visibleText(p);
    check(productText.includes("Prices show after you sign in") && !productText.includes("$"), `${tag} signed-out product page shows no prices`);
    const addsBefore = await addButtons(p);

    // Sign-in page and redirect: email and password first
    await p.goto(BASE + "/account");
    check(p.url().includes("/account/sign-in?next=%2Faccount"), `${tag} /account sends signed-out visitors to sign-in`);
    check((await p.textContent("main")).includes("Sign in with your email and password"), `${tag} sign-in asks for an email and password`);
    const attr = (sel) => p.getAttribute(sel, "autocomplete");
    check((await attr("#si-email")) === "username" && (await attr("#si-password")) === "current-password", `${tag} sign-in fields are marked for password managers`);
    await axe(p, `${tag} sign-in`);
    // A wrong password and an email nobody has get the same answer
    await tryPassword(p, "owner@kebab.test", "not-the-password");
    const wrongPassword = await p.textContent("#si-password-error");
    await tryPassword(p, `nobody${tag}@nowhere.test`, "not-the-password");
    check(wrongPassword.includes("didn’t work") && (await p.textContent("#si-password-error")) === wrongPassword, `${tag} a wrong password and an unknown email get the same answer`);
    await axe(p, `${tag} sign-in, wrong password`);
    // The other way in: a code by email. What they typed carries over.
    await p.click("text=Email me a code instead");
    await p.waitForSelector("text=The same code creates your account");
    check((await p.inputValue("#si-email")) === `nobody${tag}@nowhere.test`, `${tag} the email carries over to the code form`);
    await axe(p, `${tag} code form`);
    // Bad email
    await p.fill("#si-email", "not-an-email"); await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-email-error");
    check((await p.textContent("#si-email-error")).includes("name@example.com"), `${tag} bad email message`);
    // A new email gets a code too (open sign-up)
    await p.fill("#si-email", `stranger${tag}@nowhere.test`); await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    check((await p.textContent("main")).includes(`We sent a code to stranger${tag}@nowhere.test`), `${tag} new email gets a code`);
    check((await attr("#si-code-email")) === "username" && (await attr("#si-code")) === "one-time-code" && (await attr("#si-new-password")) === "new-password", `${tag} code step fields are marked for password managers`);
    await axe(p, `${tag} code step`);
    await p.fill("#si-code", "000000"); await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code-error");
    check((await p.textContent("#si-code-error")).includes("didn’t work"), `${tag} wrong code message`);
    // A password that is too short is turned away before the code is used
    await sendCodeStep(p, "short");
    await p.waitForSelector("#si-new-password-error");
    check((await p.textContent("#si-new-password-error")).includes("8 to 72"), `${tag} a short password gets a message`);
    check(await p.evaluate(() => document.activeElement?.id === "si-new-password"), `${tag} focus moves to the password`);
    await axe(p, `${tag} code step, short password`);
    await p.click("text=Use a different email");
    await p.waitForSelector("#si-email");

    // Existing customer: signs in with a code and sets a password in the same step
    const ownerPassword = `kebab-house-${tag}`;
    await p.fill("#si-email", "owner@kebab.test"); await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await sendCodeStep(p, ownerPassword, /\/account$/);
    check((await p.textContent("h1")) === "Kebab House", `${tag} account page shows the business`);
    // The sign-in cookie: only the server reads it, so page scripts must not see it, and it travels over https only.
    const sessionCookies = (await ctx.cookies()).filter((c) => c.name.startsWith("sb-"));
    check(sessionCookies.length > 0 && sessionCookies.every((c) => c.httpOnly && c.secure && c.sameSite === "Lax"), `${tag} the sign-in cookie is HttpOnly, Secure and SameSite=Lax (${sessionCookies.map((c) => `${c.name}: ${c.httpOnly ? "HttpOnly" : "readable"} ${c.secure ? "Secure" : "any scheme"} ${c.sameSite}`).join("; ")})`);
    check(await p.evaluate(() => !document.cookie.includes("sb-")), `${tag} page scripts cannot read the sign-in cookie`);
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
    if (HIDE) check(productText.includes("16 oz") && !productText.includes("24 oz") && !productText.includes("To be confirmed"), `${tag} product page shows the price per case, and only the sizes that have one`);
    else check(productText.includes("To be confirmed"), `${tag} product page shows the price per case, and marks sizes without one`);
    check(!productText.includes("Prices show after you sign in"), `${tag} product page drops the sign-in line for customers`);
    const priceIn = await p.evaluate(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].some((el) => getComputedStyle(el).display !== "none");
      return { column: shown('td[class*="priceCell"]'), caseLine: shown('span[class*="priceInline"]') };
    });
    check(tag === 1280 ? priceIn.column && !priceIn.caseLine : priceIn.caseLine && !priceIn.column, `${tag} price shows ${tag === 1280 ? "in its own column" : "on the case line"}`);
    check(JSON.stringify(await addButtons(p)) === JSON.stringify(addsBefore), `${tag} Add buttons do not move when prices arrive`);
    await axe(p, `${tag} product page signed in`);
    for (const [lang, label, price] of [["es", "Precio por caja", "$53.33"], ["tr", "Koli fiyatı", "$53.33"], ["ar", "سعر الكرتونة", "$53.33"]]) {
      await p.goto(`${BASE}/${lang}${PRODUCT}`);
      await p.waitForFunction((x) => document.querySelector("main").innerText.includes(x), price);
      check((await visibleText(p)).includes(label), `${tag} ${lang} product page shows the price per case (${price})`);
      if (lang === "ar") await axe(p, `${tag} Arabic product page signed in`);
    }
    await p.goto(BASE + "/en/account"); // back to English (the switcher path resets the language cookie)

    // Product cards, signed in: the lowest price per case on the photo tile, and nothing moves when it arrives.
    const cardPrice = (slug) => p.evaluate((s) => document.querySelector(`main a[href$='/${s}'] span[class*='price'] bdi`)?.textContent ?? null, slug);
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    await p.waitForFunction(() => document.querySelectorAll("main a[href*='/products/'] span[class*='price']").length > 0);
    // Hot cups: 8 oz at 36.00 and 12 oz at 42.00. Kraft boxes: 48.00 and 54.67. Dome lids: one priced size at 40.00.
    const many = HIDE ? "$53.33" : "From $53.33"; // Clear cold cups: one size for sale when hidden, 8 sizes (one priced) when on show
    check((await cardPrice("hot-cups")) === "From $36.00" && (await cardPrice("kraft-takeout-boxes")) === "From $48.00" && (await cardPrice("clear-cold-cups")) === many, `${tag} product cards show the lowest price per case: ${await cardPrice("hot-cups")}, ${await cardPrice("kraft-takeout-boxes")}, ${await cardPrice("clear-cold-cups")}`);
    const cardName = await p.evaluate(() => document.querySelector("main a[href$='/hot-cups']").textContent.replace(/\s+/g, " "));
    check(cardName.includes("From $36.00 a case"), `${tag} screen readers hear the price with "a case" (${cardName.trim()})`);
    const cardShift = await p.evaluate(() => Math.round(window.__shift * 1000) / 1000);
    check(cardShift < 0.01, `${tag} cards do not move when prices arrive (layout shift ${cardShift})`);
    const pill = await p.evaluate(() => { const el = document.querySelector("main a[href$='/kraft-takeout-boxes'] span[class*='price']"); const t = el.parentElement.getBoundingClientRect(); const r = el.getBoundingClientRect(); return r.left >= t.left && r.right <= t.right && r.top >= t.top && r.bottom <= t.bottom; });
    check(pill, `${tag} the price sits inside the photo tile`);
    await axe(p, `${tag} products page signed in`);
    if (tag === 390) await p.screenshot({ path: path.join(SHOTS, "cards-prices-390.png") });
    else await p.screenshot({ path: path.join(SHOTS, "cards-prices-1280.png") });
    for (const [lang, want] of [["es", "Desde $48.00"], ["tr", "En düşük $48.00"], ["ar", "ابتداءً من"]]) {
      await p.goto(`${BASE}/${lang}/products`, { waitUntil: "networkidle" });
      await p.waitForFunction(() => document.querySelectorAll("main a[href*='/products/'] span[class*='price']").length > 0);
      const got = await cardPrice("kraft-takeout-boxes");
      check(got.includes(want) && got.includes("$48.00"), `${tag} ${lang} card price: ${got}`);
      if (lang === "ar") { await axe(p, `${tag} Arabic products page signed in`); if (tag === 390) await p.screenshot({ path: path.join(SHOTS, "cards-prices-ar-390.png") }); }
    }
    // A signed-in customer who opens the site lands on their account, where the usual order is.
    // The pages before this one were Arabic, so the site still speaks Arabic to this visitor.
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    check(new URL(p.url()).pathname === "/ar/account", `${tag} a signed-in customer who opens the site lands on their account, in their language (${p.url()})`);
    await p.goto(BASE + "/en", { waitUntil: "networkidle" });
    check(new URL(p.url()).pathname === "/account" && (await p.textContent("h1")) === "Kebab House", `${tag} and in English (${p.url()})`);
    // The logo still opens the home page, and it speaks to a customer, not to a visitor.
    await openHome(p);
    await p.waitForFunction(() => document.querySelectorAll("main a[href*='/products/'] span[class*='price']").length > 0);
    const homeText = await p.textContent("main");
    check(!homeText.includes("Create an account") && homeText.includes("Go to your account") && homeText.includes("Ready to order?") && (await p.$("main a.btn[href='/account']")) !== null, `${tag} the home page offers a signed-in customer their account, not a new one`);
    check((await cardPrice("cold-cup-dome-lids")) === (HIDE ? "$40.00" : "From $40.00"), `${tag} home page staples show prices too (${await cardPrice("cold-cup-dome-lids")})`);

    // List: prices at a 25% margin, delivery fee, next-day option, card fee note
    await setList(p, LIST);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    let listText = await p.textContent("main");
    if (HIDE) {
      check(listText.includes("$53.33 a case") && listText.includes("$44.44 a case") && !listText.includes("To be confirmed"), `${tag} per-case prices (cost / 0.75), and no line without a price`);
      check(listText.includes("Some items are not available right now. We took them off your list."), `${tag} the list says the item without a price came off`);
      check(await p.evaluate(() => JSON.parse(localStorage.getItem("mor.list.v1")).map((l) => l.sku).join() === "CUP-PET-16,HBG-96N"), `${tag} the item without a price is off the saved list too`);
    } else {
      check(listText.includes("$53.33 a case") && listText.includes("$44.44 a case") && listText.includes("To be confirmed"), `${tag} per-case prices (cost / 0.75) and unpriced item on the list`);
    }
    check(listText.includes("$213.32") && listText.includes("$88.88"), `${tag} each priced line shows what it comes to (4 x 53.33 = 213.32, 2 x 44.44 = 88.88)`);
    check(listText.includes("$302.20"), `${tag} subtotal of priced lines (4 x 53.33 + 2 x 44.44 = 302.20)`);
    check(listText.includes("Delivery") && listText.includes("$50.00"), `${tag} delivery fee shown before ordering`);
    check(listText.includes("Paying by credit card adds 3%"), `${tag} card fee note`);
    if (HIDE) check(listText.includes("$352.20"), `${tag} total with delivery, since every line has a price (302.20 + 50 = 352.20)`);
    else check(!listText.includes("$352.20"), `${tag} no total while an item has no price`);
    if (tag === 390) {
      await p.waitForSelector("[data-order-bar]");
      const bar = await orderBar(p);
      if (HIDE) check(bar.includes("$352.20") && bar.includes("Place order"), `${tag} order bar shows the total with delivery (${bar})`);
      else check(bar.includes("To be confirmed") && bar.includes("Place order") && !bar.includes("$"), `${tag} order bar gives no total while an item has no price (${bar})`);
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
    // The confirmation says what the order comes to, from the database. This order is already the usual one, so it does not offer to save it.
    const placedText = await p.textContent("main");
    if (HIDE) check(placedText.includes("Total with delivery: $402.20"), `${tag} the confirmation shows the total the database saved`);
    else check(placedText.includes("We confirm the total before delivery.") && !placedText.includes("Total with delivery"), `${tag} the confirmation says the total comes later while an item has no price`);
    check(!placedText.includes("Make this my usual order") && placedText.includes("View order") && placedText.includes("Keep browsing"), `${tag} an order that is already the usual one does not offer to save it again`);
    check(!(await p.textContent("[role=status][aria-live]")).includes("Saved as your usual order"), `${tag} the toast from the list is gone on the confirmation`);
    // The team's alert email for that order: every line with its price and amount, the fees, the note.
    const firstNumber = placed.match(/\d+/)[0];
    let alert = (await teamEmails()).find((e) => e.subject === `New order ${firstNumber} (next day): Kebab House`);
    check(Boolean(alert) && alert.to.join() === "team@mor.test" && alert.text.includes("Placed by owner@kebab.test") && alert.text.includes("NEXT-DAY DELIVERY requested"), `${tag} the team gets an alert email for the order (${alert ? alert.subject : "none"})`);
    check(Boolean(alert) && alert.text.includes("  4 cs  CUP-PET-16  Clear cold cups, 16 oz  |  $53.33 a case, $213.32") && alert.text.includes("  2 cs  HBG-96N  ") && alert.text.includes("|  $44.44 a case, $88.88"), `${tag} the alert lists each item with its price per case and what it comes to`);
    if (HIDE) check(Boolean(alert) && alert.text.includes("Subtotal: $302.20\nDelivery: $50.00\nNext-day delivery: $50.00\nTotal: $402.20\nNote: Back door, before 10 am\n\nConfirm it in Supabase"), `${tag} the alert adds up: subtotal, delivery, next-day fee, total, then the note, with no gaps`);
    else check(Boolean(alert) && alert.text.includes("KFT-1K") && alert.text.includes("|  price to be confirmed") && alert.text.includes("Subtotal: to be confirmed\nDelivery: $50.00\nNext-day delivery: $50.00\nTotal: to be confirmed\nNote: Back door, before 10 am"), `${tag} the alert marks the item without a price and leaves the totals to be confirmed`);
    await axe(p, `${tag} order placed`);
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    let orderText = await p.textContent("main");
    check(orderText.includes("Back door, before 10 am") && orderText.includes("Received") && orderText.includes("$213.32"), `${tag} order page shows note, status and line totals`);
    check(orderText.includes("Next-day delivery") && orderText.includes("$50.00") && orderText.includes("Delivery"), `${tag} order page shows delivery and next-day fees`);
    await axe(p, `${tag} order page`);
    await p.click("text=Order these again");
    await p.waitForURL(/\/list$/);
    const reordered = HIDE ? 2 : 3;
    check(await p.evaluate((n) => JSON.parse(localStorage.getItem("mor.list.v1")).length === n, reordered), `${tag} reorder puts ${reordered} lines on the list`);

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
    check((await p.textContent("main header")).includes("Check your list, then place your order."), `${tag} the list tells a signed-in customer what to do next`);
    await p.click("button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    // A different order from the usual one: one tap makes it the usual order.
    check((await p.textContent("main")).includes("Total with delivery: $156.66"), `${tag} the confirmation shows this order's total`);
    await p.click("button:has-text('Make this my usual order')");
    await p.waitForSelector("text=Saved as your usual order");
    check((await p.$("button:has-text('Make this my usual order')")) === null, `${tag} the order becomes the usual order, and the offer goes away`);
    await axe(p, `${tag} order placed and saved as usual`);
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    orderText = await p.textContent("main");
    check(orderText.includes("$156.66") && !orderText.includes("Next-day delivery"), `${tag} order total saved, standard delivery`);
    // Standard delivery, no note: the alert has no empty line where the next-day fee and the note would be.
    alert = (await teamEmails()).filter((e) => e.subject.startsWith("New order") && e.subject.endsWith(": Kebab House") && !e.subject.includes("next day")).pop();
    check(Boolean(alert) && alert.text.includes("\n\n  2 cs  CUP-PET-16  Clear cold cups, 16 oz  |  $53.33 a case, $106.66\n\nSubtotal: $106.66\nDelivery: $50.00\nTotal: $156.66\n\nConfirm it in Supabase") && !/\n\n\n/.test(alert.text), `${tag} a standard order's alert has no stray blank line`);

    await p.goto(BASE + "/account");
    const home = await p.textContent("main");
    check(home.includes("Recent orders") && /10\d\d/.test(home) && home.includes("Saved") && home.includes("$156.66"), `${tag} account home lists usual order and orders with totals`);
    await axe(p, `${tag} account home (filled)`);
    // The usual order leads the page: what each line comes to, the total with delivery, and one button.
    const usualCard = await p.textContent("section[aria-labelledby=usual-title]");
    check(usualCard.includes("Clear cold cups") && usualCard.includes("2 cases") && usualCard.includes("$106.66") && usualCard.includes("Total with delivery") && usualCard.includes("$156.66"), `${tag} the usual order shows its lines, amounts and total with delivery`);
    const usualFirst = await p.evaluate(() => {
      const usual = document.querySelector("section[aria-labelledby=usual-title]").getBoundingClientRect();
      const recent = document.querySelector("section[aria-labelledby=recent-title]").getBoundingClientRect();
      const button = [...document.querySelectorAll("section[aria-labelledby=usual-title] button")].find((b) => b.textContent.trim() === "Order my usual").getBoundingClientRect();
      return { before: usual.top < recent.top || usual.left < recent.left, inView: button.bottom <= innerHeight, height: Math.round(button.height) };
    });
    check(usualFirst.before && usualFirst.inView && usualFirst.height >= 44, `${tag} "Order my usual" comes first and is on the first screen (${JSON.stringify(usualFirst)})`);
    await setList(p, []);
    await Promise.all([p.waitForURL(/\/list$/), p.click("button:has-text('Order my usual')")]);
    await p.waitForSelector("text=Ordering for Kebab House");
    check(await p.evaluate(() => localStorage.getItem("mor.list.v1") === JSON.stringify([{ sku: "CUP-PET-16", cases: 2 }])), `${tag} one tap puts the usual order on the list`);
    check((await p.textContent("[role=status][aria-live]")).includes("Your usual order is on your list"), `${tag} the list says the usual order is on it`);
    // Every past order can go back on the list from the account page.
    await p.goto(BASE + "/account");
    const againLabels = await p.$$eval("section[aria-labelledby=recent-title] button:visible", (els) => els.map((e) => `${e.textContent.trim()}|${e.getAttribute("aria-label")}`));
    check(againLabels.length >= 3 && againLabels.every((l) => /^Order again\|Order 10\d\d again$/.test(l)), `${tag} each recent order has Order again, named by its number (${againLabels.slice(0, 2).join(", ")})`);
    const againSize = await p.$eval("section[aria-labelledby=recent-title] button:visible", (e) => Math.round(e.getBoundingClientRect().height));
    check(againSize >= 44, `${tag} Order again is ${againSize} px tall`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} the account page does not run off the side`);
    await setList(p, []);
    await Promise.all([p.waitForURL(/\/list$/), p.click(`section[aria-labelledby=recent-title] button[aria-label="Order ${firstNumber} again"]:visible`)]);
    await p.waitForSelector("text=Ordering for Kebab House");
    const againLines = await p.evaluate(() => JSON.parse(localStorage.getItem("mor.list.v1")).map((l) => `${l.sku}x${l.cases}`).join(","));
    check(againLines === "CUP-PET-16x4,HBG-96Nx2" + (HIDE ? "" : ",KFT-1Kx1"), `${tag} Order again puts that order's lines on the list (${againLines})`);
    await setList(p, []);
    await p.goto(BASE + "/account");
    await p.goto(BASE + "/account/orders");
    await axe(p, `${tag} order history`);
    // The weekly order. While weekly orders are switched off for the site, a customer can only ask.
    await p.request.post(`${MOCK}/__test/weekly`, { data: { live: false } });
    await p.goto(BASE + "/account");
    let weeklyBox = await p.textContent("section[aria-labelledby=usual-title]");
    check(weeklyBox.includes("Weekly order") && weeklyBox.includes("Get your usual order every week.") && weeklyBox.includes("Ask for a weekly order") && !weeklyBox.includes("Turn on my weekly order"), `${tag} the usual order offers a weekly order, as a request while the site has not switched them on`);
    await Promise.all([p.waitForURL(/\/account\?weekly=asked$/), p.click("button:has-text('Ask for a weekly order')")]);
    weeklyBox = await p.textContent("main");
    check((weeklyBox.match(/You asked for a weekly order\. We will tell you before the first one goes out\./g) ?? []).length === 2 && weeklyBox.includes("Cancel my request") && !weeklyBox.includes("Next delivery"), `${tag} asking is confirmed, and promises nothing that is not running yet`);
    await axe(p, `${tag} weekly order asked for`);
    let weeklyMail = (await teamEmails()).filter((e) => e.subject === "Weekly order asked for: Kebab House").pop();
    check(Boolean(weeklyMail) && weeklyMail.text.includes("Asked by owner@kebab.test") && weeklyMail.text.includes("Delivery day: Thursday") && weeklyMail.text.includes("Nothing is placed automatically until weekly orders are switched on"), `${tag} the team hears who asked for a weekly order`);
    await Promise.all([p.waitForURL(/\/account\?weekly=off$/), p.click("button:has-text('Cancel my request')")]);
    check((await p.textContent("main")).includes("Your weekly order is off.") && (await p.textContent("main")).includes("Ask for a weekly order"), `${tag} the request can be taken back`);
    weeklyMail = (await teamEmails()).filter((e) => e.subject === "Weekly order turned off: Kebab House").pop();
    check(Boolean(weeklyMail) && weeklyMail.text.includes("Turned off by owner@kebab.test"), `${tag} and the team hears that too`);
    // Switched on for the site, with a delivery day: it runs, shows the next delivery and when its order closes.
    await p.request.post(`${MOCK}/__test/weekly`, { data: { live: true } });
    await p.goto(BASE + "/account");
    await Promise.all([p.waitForURL(/\/account\?weekly=asked$/), p.click("button:has-text('Turn on my weekly order')")]);
    weeklyBox = await p.textContent("section[aria-labelledby=usual-title]");
    const nextLine = weeklyBox.match(/Next delivery: (Thursday, [A-Z][a-z]+ \d{1,2})\. We place the order on (Tuesday, [A-Z][a-z]+ \d{1,2})(?:,| at) 5:00 PM\./);
    check(Boolean(nextLine) && weeklyBox.includes("Your weekly order is on.") && weeklyBox.includes("To change what comes, change your usual order before then."), `${tag} a running weekly order names the next delivery and when its order closes (${nextLine ? nextLine[0] : weeklyBox.slice(-200)})`);
    check((await p.textContent("header + div, main header")).includes("Your weekly order is on."), `${tag} turning it on is confirmed at the top of the page`);
    await axe(p, `${tag} weekly order on`);
    const skipName = `Skip ${nextLine ? nextLine[1] : ""}`;
    await Promise.all([p.waitForURL(/\/account\?weekly=skipped$/), p.click(`button:has-text("${skipName}")`)]);
    weeklyBox = await p.textContent("section[aria-labelledby=usual-title]");
    check(new RegExp(`You are skipping ${nextLine ? nextLine[1] : "x"}\\. The next one is Thursday, [A-Z][a-z]+ \\d{1,2}\\.`).test(weeklyBox) && weeklyBox.includes("Don’t skip") && !weeklyBox.includes("Next delivery:"), `${tag} one delivery can be skipped, and the page says which comes next`);
    await Promise.all([p.waitForURL(/\/account\?weekly=unskipped$/), p.click("button:has-text('Don’t skip')")]);
    check((await p.textContent("section[aria-labelledby=usual-title]")).includes("Next delivery:"), `${tag} the skip can be taken back`);
    // Saving a different usual order keeps the weekly order on.
    await setList(p, [{ sku: "CUP-PET-16", cases: 2 }]);
    await p.goto(BASE + "/list"); await p.waitForSelector("text=Ordering for Kebab House");
    await p.click("text=Save as my usual order"); await p.waitForSelector("text=Saved as your usual order");
    await setList(p, []);
    await p.goto(BASE + "/account");
    check((await p.textContent("section[aria-labelledby=usual-title]")).includes("Your weekly order is on."), `${tag} saving the usual order again keeps the weekly order on`);
    // A change that fails says so and changes nothing.
    await p.request.post(`${MOCK}/__test/weekly`, { data: { fail: 1 } });
    await Promise.all([p.waitForURL(/\/account\?weekly=failed$/), p.click("button:has-text('Turn off my weekly order')")]);
    check((await p.textContent("main")).includes("We couldn’t change your weekly order.") && (await p.textContent("section[aria-labelledby=usual-title]")).includes("Your weekly order is on."), `${tag} a change that fails says so and leaves the weekly order as it was`);
    for (const [lang, want] of [["es", "Próxima entrega: jueves"], ["tr", "Sonraki teslimat:"], ["ar", "التوصيل القادم: الخميس"]]) {
      await p.goto(`${BASE}/${lang}/account`);
      const box = await p.textContent("section[aria-labelledby=usual-title]");
      check(box.includes(want) && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} ${lang} weekly order reads right and fits (${(box.match(new RegExp(want + "[^.]*\\.")) ?? [""])[0]})`);
      if (lang === "ar") await axe(p, `${tag} Arabic weekly order`);
    }
    await p.goto(BASE + "/en/account");
    await Promise.all([p.waitForURL(/\/account\?weekly=off$/), p.click("button:has-text('Turn off my weekly order')")]);
    await p.request.post(`${MOCK}/__test/weekly`, { data: { live: false } });

    // Self-service: the business card, and the owner correcting the details.
    await p.goto(BASE + "/account");
    const card = await p.textContent("section[aria-labelledby=business-title]");
    check(card.includes("Kebab House") && / 30\d{3}/.test(card) && card.includes("(404) 555-") && card.includes("Edit details"), `${tag} the account page shows where we deliver and whom we call (${card.replace(/\s+/g, " ").slice(0, 90)})`);
    await Promise.all([p.waitForURL(/\/account\/details$/), p.click("text=Edit details")]);
    await p.waitForSelector("#su-street");
    const onFile = await p.evaluate(() => ["businessName", "street", "city", "zip", "contactName", "phone", "language"].map((n) => document.querySelector(`[name="${n}"]`).value).join("|"));
    check(/^Kebab House\|.+\|.+\|\d{5}\|Ali\|\(404\) 555-\d{4}\|en$/.test(onFile), `${tag} the details form opens with what is on file (${onFile})`);
    await axe(p, `${tag} business details form`);
    // Each screen size moves the business somewhere new, so every field below really changes.
    const street = `${tag} Tenth St`;
    const [town, zip, phone] = tag === 1280 ? ["Atlanta", "30309", "404 555 0188"] : ["Decatur", "30030", "404 555 0199"];
    const shownPhone = `(404) 555-${phone.slice(-4)}`;
    await p.fill("#su-street", street); await p.fill("#su-city", town); await p.fill("#su-zip", zip.slice(0, 4));
    await p.click("button:has-text('Save details')");
    check((await p.textContent("#su-zip-error")) === "Enter a 5-digit ZIP code." && (await p.inputValue("#su-street")) === street, `${tag} a short ZIP is caught and the rest stays typed`);
    await p.fill("#su-zip", zip); await p.fill("#su-phone", phone);
    await p.request.post(`${MOCK}/__test/fail-details`, { data: { times: 1 } });
    await p.click("button:has-text('Save details')");
    await p.waitForSelector("text=We couldn’t save your details");
    check((await p.inputValue("#su-street")) === street && (await p.inputValue("#su-phone")) === phone, `${tag} when saving fails the details form keeps what was typed`);
    await Promise.all([p.waitForURL(/\/account\?details=saved$/), p.click("button:has-text('Save details')")]);
    const saved = await p.textContent("main");
    check(saved.includes("Your business details are saved.") && saved.includes(street) && saved.includes(`${town} ${zip}`) && saved.includes(shownPhone), `${tag} the account page confirms the change and shows it`);
    await axe(p, `${tag} account page, details saved`);
    const changed = (await teamEmails()).filter((e) => e.subject === "Details changed: Kebab House").pop();
    check(Boolean(changed) && changed.text.includes("Changed by owner@kebab.test") && changed.text.includes(` -> ${street}`) && changed.text.includes(` -> ${zip}`) && changed.text.includes(` -> ${shownPhone}`) && !changed.text.includes("Business:") && !changed.text.includes("Contact:"), `${tag} the team hears what changed, and only that`);
    // Saving again with nothing changed sends no second email.
    const before = (await teamEmails()).filter((e) => e.subject === "Details changed: Kebab House").length;
    await p.goto(BASE + "/account/details"); await p.waitForSelector("#su-street");
    await Promise.all([p.waitForURL(/\/account\?details=saved$/), p.click("button:has-text('Save details')")]);
    check((await teamEmails()).filter((e) => e.subject === "Details changed: Kebab House").length === before, `${tag} saving with nothing changed sends no email`);

    // Canceling: only while the order is still received, and only after a second tap.
    await setList(p, [{ sku: "HBG-96N", cases: 1 }]);
    await p.goto(BASE + "/list"); await p.waitForSelector("text=Ordering for Kebab House");
    await p.click("button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    const cancelNumber = (await p.textContent("h2")).match(/\d+/)[0];
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    check((await p.textContent("main")).includes("You can cancel until we confirm the order."), `${tag} a received order can be canceled, and says until when`);
    await p.click("button:has-text('Cancel this order')");
    await p.waitForSelector("text=This cannot be undone.");
    check(await p.evaluate(() => document.activeElement?.textContent?.includes("This cannot be undone")), `${tag} the first tap only asks, and focus moves to the question`);
    await axe(p, `${tag} cancel question`);
    await p.click("button:has-text('Keep it')");
    check((await p.$("text=This cannot be undone.")) === null && (await p.textContent("main")).includes("Received") && await p.evaluate(() => document.activeElement?.textContent === "Cancel this order"), `${tag} "Keep it" leaves the order alone`);
    await p.click("button:has-text('Cancel this order')");
    await Promise.all([p.waitForURL(/\?canceled=1$/), p.click("button:has-text('Yes, cancel it')")]);
    const canceledText = await p.textContent("main");
    check(canceledText.includes(`Order ${cancelNumber} is canceled.`) && canceledText.includes("Canceled") && !canceledText.includes("Cancel this order"), `${tag} the order reads canceled and cannot be canceled twice`);
    await axe(p, `${tag} canceled order`);
    const gone = (await teamEmails()).filter((e) => e.subject === `Order ${cancelNumber} canceled: Kebab House`);
    check(gone.length === 1 && gone[0].text.includes("Canceled by owner@kebab.test"), `${tag} the team gets one email about the canceled order`);
    // The team confirms an order while the customer still has the page open: too late, and the page says so.
    await setList(p, [{ sku: "HBG-96N", cases: 2 }]);
    await p.goto(BASE + "/list"); await p.waitForSelector("text=Ordering for Kebab House");
    await p.click("button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    const lateNumber = (await p.textContent("h2")).match(/\d+/)[0];
    await Promise.all([p.waitForURL(/\/account\/orders\/\d+$/), p.click("text=View order")]);
    await p.request.post(`${MOCK}/__test/order-status`, { data: { number: lateNumber, status: "confirmed" } });
    await p.click("button:has-text('Cancel this order')");
    await Promise.all([p.waitForURL(/\?late=1$/), p.click("button:has-text('Yes, cancel it')")]);
    const lateText = await p.textContent("main");
    check(lateText.includes("already confirmed") && lateText.includes("Confirmed") && !lateText.includes("Cancel this order"), `${tag} a confirmed order is too late to cancel, and the page says so`);
    check((await teamEmails()).filter((e) => e.subject === `Order ${lateNumber} canceled: Kebab House`).length === 0, `${tag} no cancel email for an order that stayed`);
    // Staff who only order can cancel, and can read the details but not change them.
    await signOut(p);
    await signIn(p, "buyer@kebab.test");
    const buyerCard = await p.textContent("section[aria-labelledby=business-title]");
    check(buyerCard.includes(street) && buyerCard.includes("Only the account owner can change these details.") && !buyerCard.includes("Edit details"), `${tag} a buyer reads the business details and is told who can change them`);
    await p.goto(BASE + "/account/details");
    check(new URL(p.url()).pathname === "/account", `${tag} the details form sends a buyer back to the account (${p.url()})`);
    await signOut(p);
    await signIn(p, "owner@kebab.test");

    await p.goto(BASE + "/ar/account/details"); await p.waitForSelector("#su-street");
    check((await p.getAttribute("html", "dir")) === "rtl" && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} Arabic details form fits the screen`);
    await axe(p, `${tag} Arabic details form`);
    await p.goto(BASE + "/ar/account");
    check((await p.getAttribute("html", "dir")) === "rtl" && (await p.textContent("main")).includes("يوم التوصيل"), `${tag} Arabic account page`);
    await axe(p, `${tag} Arabic account`);
    // Spanish and Turkish have the longest button labels: the usual order card must not push the page sideways.
    for (const lang of ["es", "tr"]) {
      await p.goto(`${BASE}/${lang}/account`);
      await axe(p, `${tag} ${lang} account`);
    }
    await p.goto(BASE + "/en/account"); // back to English (the switcher path resets the language cookie)
    await p.goto(BASE + "/no-such-page");
    // The title of a page that is rendered on request can arrive a moment after the page.
    await p.waitForFunction(() => document.title.startsWith("We couldn’t find that page"), null, { timeout: 5000 }).catch(() => {});
    check((await p.title()).startsWith("We couldn’t find that page"), `${tag} the not-found page has its own title (${await p.title()})`);
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
    // The password set with that first code now signs them in, with no email
    await signInWithPassword(p, "owner@kebab.test", ownerPassword);
    check((await p.textContent("h1")) === "Kebab House" && (await p.textContent("main")).includes("Change password"), `${tag} password sign-in lands on the account, which offers Change password`);
    await signOut(p);

    // Signed out, the list asks people to sign in to order
    await setList(p, [{ sku: "CUP-PET-16", cases: 1 }]);
    await p.goto(BASE + "/list");
    check((await p.textContent("aside")).includes("Sign in to order") && !(await p.textContent("main")).includes("$"), `${tag} signed-out list asks to sign in, no prices`);
    // The list is read from the device after the page loads. The footer must not jump when it shows, empty or not.
    for (const [name, lines] of [["an empty list", []], ["a list with three lines", LIST]]) {
      await setList(p, lines);
      await p.goto(BASE + "/list", { waitUntil: "networkidle" });
      await p.waitForTimeout(300);
      const shift = await p.evaluate(() => Math.round(window.__shift * 1000) / 1000);
      check(shift < 0.01, `${tag} ${name} loads without the page jumping (layout shift ${shift})`);
    }
    if (tag === 390) {
      await setList(p, PRICED);
      await p.goto(BASE + "/list");
      await p.waitForSelector("[data-order-bar] a");
      const bar = await orderBar(p);
      check(bar.includes("4 items") && bar.includes("Sign in to order") && !bar.includes("$"), `${tag} signed-out order bar counts the list and asks to sign in (${bar})`);
    }

    // Open sign-up: new email, then the business form, then ordering
    const chef = `chef${tag}@new.test`;
    // The way a new customer arrives: the sign-in page, then its "Create an account" link. The link only changes
    // the address, so the form has to follow it (it used to stay on the password form).
    await p.goto(BASE + "/account/sign-in?next=%2Faccount");
    await p.fill("#si-email", chef);
    await Promise.all([p.waitForURL(/\/account\/sign-in\?new=1&next=%2Faccount$/), p.click("main a:has-text('Create an account')")]);
    await p.waitForSelector("text=Then choose a password", { timeout: 5000 }).catch(() => {});
    check((await p.textContent("main h1")) === "Create your account" && (await p.locator("#si-password").count()) === 0, `${tag} "Create an account" on the sign-in page opens the create form`);
    check((await p.inputValue("#si-email")) === chef, `${tag} the email typed before the link is kept`);
    check((await p.textContent("main")).includes("Then choose a password"), `${tag} account creation says a password comes next`);
    await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await sendCodeStep(p, null);
    await p.waitForSelector("#si-new-password-error");
    check((await p.textContent("label[for=si-new-password]")).trim() === "Choose a password" && (await p.textContent("main form button[type=submit]")).trim() === "Create account", `${tag} a new account has to choose a password`);
    await sendCodeStep(p, `pho-place-${tag}`, /\/account\/setup/);
    check(p.url().includes("/account/setup?next=%2Faccount"), `${tag} first sign-in goes to the business form`);
    check((await p.textContent("main")).includes(`Signed in as ${chef}`), `${tag} business form shows the email`);
    await axe(p, `${tag} business form`);
    // The form is short: required fields, the text message box, and one closed group of optional details.
    const formSize = await p.evaluate(() => ({ screens: document.documentElement.scrollHeight / innerHeight, open: document.querySelector("main form details").open, wide: document.documentElement.scrollWidth - innerWidth }));
    if (vp.width < 600) check(formSize.screens <= 1.75, `${tag} business form page is ${formSize.screens.toFixed(2)} screens on a phone`);
    check(!formSize.open && formSize.wide <= 0, `${tag} optional details start closed and nothing runs off the side`);
    // Fields are checked in the browser first: nothing goes to the server, so nothing typed is lost.
    let setupPosts = 0;
    const countPost = (r) => { if (r.method() === "POST" && r.url().includes("/account/setup")) setupPosts++; };
    p.on("request", countPost);
    await p.click("button:has-text('Start ordering')");
    await p.waitForSelector("#su-businessName-error");
    check((await p.textContent("#su-businessName-error")).includes("Enter your business name"), `${tag} business form explains missing fields`);
    check(await p.evaluate(() => document.activeElement?.id === "su-businessName"), `${tag} focus moves to the first problem`);
    check((await p.$$(".error-text")).length === 6 && setupPosts === 0, `${tag} an empty business form is stopped in the browser (${setupPosts} sent)`);
    await axe(p, `${tag} business form errors`);
    await p.fill("#su-businessName", "Pho Place");
    check((await p.$("#su-businessName-error")) === null, `${tag} a message goes away once its field is right`);
    await p.fill("#su-street", "1 Peachtree St");
    await p.fill("#su-city", "Atlanta");
    await p.fill("#su-zip", "3030");
    await p.fill("#su-contactName", "Linh");
    await p.fill("#su-phone", "404 555 0123");
    await p.click("button:has-text('Start ordering')");
    check((await p.textContent("#su-zip-error")) === "Enter a 5-digit ZIP code." && setupPosts === 0 && (await p.inputValue("#su-city")) === "Atlanta", `${tag} a short ZIP is caught before sending and the rest stays typed`);
    await p.fill("#su-zip", "30303");
    await p.click("main form summary");
    await p.selectOption("#su-businessType", "restaurant");
    await p.check("#su-sms");
    // The server cannot save it this once: everything typed is still there for another try.
    await p.request.post(`${MOCK}/__test/fail-account`, { data: { times: 1 } });
    await p.click("button:has-text('Start ordering')");
    await p.waitForSelector("text=We couldn’t save your business");
    const keptForm = await p.evaluate(() => ["businessName", "street", "city", "zip", "contactName", "phone", "businessType", "language"].map((n) => document.querySelector(`[name="${n}"]`).value).concat([document.querySelector("#su-sms").checked, document.querySelector("main form details").open]).join("|"));
    check(keptForm === "Pho Place|1 Peachtree St|Atlanta|30303|Linh|404 555 0123|restaurant|en|true|true", `${tag} the business form keeps what was typed when saving fails (${keptForm})`);
    p.off("request", countPost);
    await Promise.all([p.waitForURL(/\/account$/), p.click("button:has-text('Start ordering')")]);
    check((await p.textContent("h1")) === "Pho Place", `${tag} new account is ready right away`);
    const welcome = (await teamEmails()).filter((e) => e.subject === "New account: Pho Place").pop();
    check(Boolean(welcome) && welcome.text.includes(`Email: ${chef}`) && welcome.text.includes("Contact: Linh\nPhone: +14045550123\n") && welcome.text.includes("Address: 1 Peachtree St, Atlanta 30303\nType: restaurant\nLanguage: en\n\nThey can see prices"), `${tag} the team gets an email about the new account, with the type they chose`);
    check((await p.textContent("main")).includes("Your prices show on product pages"), `${tag} new account sees prices`);
    await setList(p, [{ sku: "HBG-96N", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Pho Place");
    check((await p.textContent("main")).includes("$44.44 a case") && (await p.textContent("aside")).includes("$94.44"), `${tag} new account can order at the same prices`);
    // A new account has no delivery day yet: it can ask for a weekly order, and is told the day comes first.
    await p.click("text=Save as my usual order"); await p.waitForSelector("text=Saved as your usual order");
    await setList(p, []);
    await p.goto(BASE + "/account");
    await Promise.all([p.waitForURL(/\/account\?weekly=asked$/), p.click("button:has-text('Ask for a weekly order')")]);
    check((await p.textContent("main")).includes("We will set your delivery day and tell you before the first one."), `${tag} without a delivery day, asking says the day comes first`);
    const askedMail = (await teamEmails()).filter((e) => e.subject === "Weekly order asked for: Pho Place").pop();
    check(Boolean(askedMail) && askedMail.text.includes(`Asked by ${chef}`) && askedMail.text.includes("No delivery day yet. Set one in Supabase"), `${tag} the team is told to set a delivery day`);
    await signOut(p);
    await signInWithPassword(p, chef, `pho-place-${tag}`);
    check((await p.textContent("h1")) === "Pho Place", `${tag} the new account signs in with its password`);
    await signOut(p);

    // /request-account now starts sign-up
    await p.goto(BASE + "/request-account");
    await p.waitForSelector("#si-email");
    check(p.url().includes("/account/sign-in?new=1") && (await p.textContent("h1")) === "Create your account", `${tag} request page opens account creation`);
    // With nowhere else to go, a new account lands on the products and is told it is ready, once.
    await p.fill("#si-email", `baker${tag}@new.test`); await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await sendCodeStep(p, `bake-shop-${tag}`, /\/account\/setup$/);
    await p.fill("#su-businessName", "Bake Shop"); await p.fill("#su-street", "5 Elm St"); await p.fill("#su-city", "Decatur"); await p.fill("#su-zip", "30030"); await p.fill("#su-contactName", "Rosa"); await p.fill("#su-phone", "404 555 0177");
    await Promise.all([p.waitForURL(/\/products/), p.click("button:has-text('Start ordering')")]);
    await p.waitForSelector("text=Your account is ready");
    check(!p.url().includes("welcome") && (await p.textContent("[role=status][aria-live]")).includes("Add what you need, then place your order."), `${tag} a new account lands on the products and hears it is ready (${p.url()})`);
    const bakeMail = (await teamEmails()).filter((e) => e.subject === "New account: Bake Shop").pop();
    check(Boolean(bakeMail) && bakeMail.text.includes("Address: 5 Elm St, Decatur 30030\nLanguage: en\n\nThey can see prices"), `${tag} the team email leaves no gap for details that were skipped`);
    // A toast belongs to the page it was shown on: it does not follow the customer to the next one.
    await p.goto(BASE + "/products/cups-lids/clear-cold-cups");
    await p.click("main button[aria-label^='Add ']");
    await p.waitForSelector("text=View list");
    await p.evaluate(() => document.querySelector("header a[href='/list']").click());
    await p.waitForURL(/\/list$/);
    await p.waitForSelector("text=Ordering for Bake Shop");
    check(!(await p.textContent("[role=status][aria-live]")).includes("View list"), `${tag} the Added toast stays behind when the customer opens the list`);
    await p.evaluate(() => localStorage.removeItem("mor.list.v1"));
    await signOut(p);
    // The note is for the person who just made the account, not for anyone who opens the same address.
    await p.goto(BASE + "/products?welcome=1");
    await p.waitForLoadState("networkidle");
    check(!p.url().includes("welcome") && !(await p.textContent("[role=status][aria-live]")).includes("Your account is ready"), `${tag} a signed-out visitor is not told an account is ready`);

    // A crafted "next" never sends people to another site after they sign in.
    // Browsers drop tabs and line breaks from URLs and read "\" as "/", so each of these would become "//example.com".
    const site = new URL(BASE).origin;
    for (const [name, bad] of [["a tab", "/%09/example.com/x"], ["a line feed", "/%0A/example.com/x"], ["a carriage return", "/%0D/example.com/x"], ["a backslash", "/%5Cexample.com/x"], ["two slashes", "//example.com/x"]]) {
      await signInWithPassword(p, "owner@kebab.test", ownerPassword, `/account/sign-in?next=${bad}`, (u) => !u.pathname.includes("/sign-in"));
      check(p.url() === `${site}/account`, `${tag} sign-in ignores a next with ${name} (landed on ${p.url()})`);
      // Signed in with a business already: the business form forwards, and must stay on the site too.
      const hop = await p.request.get(`${BASE}/account/setup?next=${bad}`, { maxRedirects: 0 });
      check(hop.status() === 307 && hop.headers()["location"] === "/account", `${tag} business form ignores a next with ${name} (${hop.status()} ${JSON.stringify(hop.headers()["location"])})`);
      await signOut(p);
    }
    // The code form drops a crafted next too, and both forms keep a normal one.
    await p.goto(`${BASE}/account/sign-in?code=1&next=/%09/example.com/x`);
    await p.fill("#si-email", "owner@kebab.test");
    await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await sendCodeStep(p, null, (u) => !u.pathname.includes("/sign-in"));
    check(p.url() === `${site}/account`, `${tag} code sign-in ignores a next with a tab (landed on ${p.url()})`);
    await signOut(p);
    await p.goto(`${BASE}/account/sign-in?code=1&next=%2Faccount%2Forders`);
    await p.fill("#si-email", "owner@kebab.test");
    await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await sendCodeStep(p, null, /\/account\/orders$/);
    check(p.url() === `${site}/account/orders`, `${tag} code sign-in still returns people to the page they came from`);
    await signOut(p);
    await signInWithPassword(p, "owner@kebab.test", ownerPassword, "/account/sign-in?next=%2Faccount%2Forders", /\/account\/orders$/);
    check(p.url() === `${site}/account/orders`, `${tag} password sign-in returns people to the page they came from`);

    // Changing a password: a fresh code, then the new password. The old one stops working.
    await p.goto(BASE + "/account");
    await Promise.all([p.waitForURL(/\/account\/sign-in\?reset=1$/), p.click("text=Change password")]);
    check((await p.textContent("h1")) === "Change your password" && (await p.inputValue("#si-email")) === "owner@kebab.test" && (await p.getAttribute("#si-email", "readonly")) !== null, `${tag} change password shows the account's email, locked`);
    await axe(p, `${tag} change password`);
    await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    check((await p.textContent("main form button[type=submit]")).trim() === "Save password", `${tag} change password asks for the code and a new password`);
    const newPassword = `kebab-new-${tag}`;
    await sendCodeStep(p, newPassword, /\/account\?password=saved$/);
    check((await p.textContent("main [role=status]")).includes("Your new password is saved."), `${tag} the account page confirms the new password`);
    await axe(p, `${tag} account page, password saved`);
    await signOut(p);
    await p.goto(BASE + "/account/sign-in");
    await tryPassword(p, "owner@kebab.test", ownerPassword);
    check((await p.textContent("#si-password-error")).includes("didn’t work"), `${tag} the old password no longer works`);
    await signInWithPassword(p, "owner@kebab.test", newPassword);
    // A password Supabase refuses: still signed in, and the account page says it was not saved
    await p.goto(BASE + "/account/sign-in?reset=1");
    await p.click("main form button[type=submit]");
    await p.waitForSelector("#si-code");
    await sendCodeStep(p, "pwned-password", /\/account\?password=unsaved$/);
    const unsaved = await p.textContent("main [role=status]");
    check(unsaved.includes("couldn’t save your password") && unsaved.includes("Change password"), `${tag} a refused password leaves them signed in and says so (${unsaved.trim()})`);
    await axe(p, `${tag} account page, password not saved`);
    await signOut(p);
    await signInWithPassword(p, "owner@kebab.test", newPassword);
    check((await p.textContent("h1")) === "Kebab House", `${tag} the password before the refused one still works`);
    await signOut(p);
    // Signed out, ?reset=1 is the forgotten-password door: the code form
    await p.goto(BASE + "/account/sign-in?reset=1");
    check((await p.textContent("h1")) === "Sign in" && (await p.textContent("main")).includes("we’ll send you a code") && (await p.$("#si-password")) === null, `${tag} signed out, the reset link opens the code form`);

    // A switched-off account
    await signIn(p, "paused@spot.test");
    check((await p.textContent("h1")).includes("paused"), `${tag} switched-off account sees the paused message`);
    await axe(p, `${tag} paused account`);
    await p.goto(BASE + PRODUCT, { waitUntil: "networkidle" });
    productText = await visibleText(p);
    check(!productText.includes("$") && !productText.includes("Prices show after you sign in"), `${tag} switched-off account sees no prices on product pages`);
    await p.goto(BASE + "/products", { waitUntil: "networkidle" });
    check((await p.$$("main a[href*='/products/'] span[class*='price']")).length === 0, `${tag} or on product cards`);
    await signOut(p);
    check(errors.length === 0, `${tag} no page errors ${errors.join(" | ")}`);
    check(blocked.length === 0, `${tag} the content security policy blocked nothing on any page of this run ${blocked.join(" | ")}`);
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
