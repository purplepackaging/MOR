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
  await p.addScriptTag({ content: axeSrc });
  const r = await p.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const v = r.violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")}`);
  check(v.length === 0 && !hs, `axe ${label}${v.length ? " -> " + v.join(" | ") : ""}${hs ? " HSCROLL" : ""}`);
}
async function signIn(p, email, code = "123456") {
  await p.goto(BASE + "/account");
  await p.fill("#si-email", email);
  await p.click("button[type=submit]");
  await p.waitForSelector("#si-code");
  await p.fill("#si-code", code);
  await Promise.all([p.waitForURL(/\/account$/), p.click("form button[type=submit]")]);
}
(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const ctx = await b.newContext({ viewport: vp });
    const p = await ctx.newPage();
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    const tag = vp.width;

    // Sign-in page and redirect
    await p.goto(BASE + "/account");
    check(p.url().includes("/account/sign-in?next=%2Faccount"), `${tag} /account sends signed-out visitors to sign-in`);
    await axe(p, `${tag} sign-in`);
    // Bad email
    await p.fill("#si-email", "not-an-email"); await p.click("button[type=submit]");
    await p.waitForSelector("#si-email-error");
    check((await p.textContent("#si-email-error")).includes("name@example.com"), `${tag} bad email message`);
    // Unknown email still moves on (no enumeration)
    await p.fill("#si-email", "stranger@nowhere.test"); await p.click("button[type=submit]");
    await p.waitForSelector("#si-code");
    check((await p.textContent("main")).includes("If stranger@nowhere.test has a MOR account"), `${tag} unknown email gets the same answer`);
    await axe(p, `${tag} code step`);
    await p.fill("#si-code", "000000"); await p.click("form button[type=submit]");
    await p.waitForSelector("#si-code-error");
    check((await p.textContent("#si-code-error")).includes("didn’t work"), `${tag} wrong code message`);
    await p.click("text=Use a different email");
    await p.waitForSelector("#si-email");

    // Real sign in
    await p.fill("#si-email", "owner@kebab.test"); await p.click("button[type=submit]");
    await p.waitForSelector("#si-code");
    await p.fill("#si-code", "123456");
    await Promise.all([p.waitForURL(/\/account$/), p.click("form button[type=submit]")]);
    check((await p.textContent("h1")) === "Kebab House", `${tag} account page shows the business`);
    check((await p.textContent("main")).includes("Delivery day: Thursday"), `${tag} delivery day pill`);
    check((await p.textContent("main")).includes("Your prices show on your list"), `${tag} priced account message`);
    if (tag === 1280) {
      await p.waitForTimeout(400);
      check((await p.textContent("header")).includes("Your account"), `${tag} header switches to Your account`);
    }
    await axe(p, `${tag} account home (empty)`);

    // Build a list, save usual, place order
    await p.evaluate(() => localStorage.setItem("mor.list.v1", JSON.stringify([{ sku: "CUP-PET-16", cases: 4 }, { sku: "HBG-96N", cases: 2 }, { sku: "KFT-1K", cases: 1 }])));
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    const listText = await p.textContent("main");
    check(listText.includes("$52.00 a case") && listText.includes("$43.33 a case") && listText.includes("To be confirmed"), `${tag} per-case prices and unpriced item on the list`);
    check(listText.includes("$294.66"), `${tag} subtotal of priced lines (4 x 52 + 2 x 43.33 = 294.66)`);
    await axe(p, `${tag} list signed in`);
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
    const orderText = await p.textContent("main");
    check(orderText.includes("Back door, before 10 am") && orderText.includes("Received") && orderText.includes("$208.00"), `${tag} order page shows note, status and line totals`);
    await axe(p, `${tag} order page`);
    await p.click("text=Order these again");
    await p.waitForURL(/\/list$/);
    check(await p.evaluate(() => JSON.parse(localStorage.getItem("mor.list.v1")).length === 3), `${tag} reorder puts 3 lines on the list`);
    await p.goto(BASE + "/account");
    const home = await p.textContent("main");
    check(home.includes("Recent orders") && /10\d\d/.test(home) && home.includes("Saved"), `${tag} account home lists usual order and the order`);
    await axe(p, `${tag} account home (filled)`);
    await p.goto(BASE + "/account/orders");
    await axe(p, `${tag} order history`);
    await p.goto(BASE + "/ar/account");
    check((await p.getAttribute("html", "dir")) === "rtl" && (await p.textContent("main")).includes("يوم التوصيل"), `${tag} Arabic account page`);
    await axe(p, `${tag} Arabic account`);
    await p.goto(BASE + "/en/account"); // back to English (the switcher path resets the language cookie)
    await p.goto(BASE + "/account/orders/999999");
    check((await p.textContent("h1")).length > 0 && (await p.textContent("main")).toLowerCase().includes("couldn"), `${tag} unknown order number is a 404`);
    // Sign out
    await p.goto(BASE + "/account");
    await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.click("button:has-text('Sign out')")]);
    await p.goto(BASE + "/account");
    check(p.url().includes("/account/sign-in"), `${tag} signed out`);

    // Account without a tier, and a user with no account
    await signIn(p, "taco@spot.test");
    check((await p.textContent("main")).includes("setting up your prices"), `${tag} no-tier account explains prices`);
    await p.evaluate(() => localStorage.setItem("mor.list.v1", JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])));
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Taco Spot");
    const tl = await p.textContent("main");
    check(!tl.includes("$") && tl.includes("setting up your prices and confirms the total"), `${tag} no prices on the list before a tier is set`);
    await p.goto(BASE + "/account");
    await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.click("button:has-text('Sign out')")]);
    await signIn(p, "new@user.test");
    check((await p.textContent("h1")).includes("isn’t ready yet"), `${tag} unlinked user sees the not-ready message`);
    await axe(p, `${tag} not linked`);
    await Promise.all([p.waitForURL((u) => u.pathname === "/"), p.click("button:has-text('Sign out')")]);
    check(errors.length === 0, `${tag} no page errors ${errors.join(" | ")}`);
    if (tag === 1280) {
      // Screenshots for review
      await signIn(p, "owner@kebab.test");
      await p.screenshot({ path: path.join(SHOTS, "portal-account.png"), fullPage: true });
      await p.evaluate(() => localStorage.setItem("mor.list.v1", JSON.stringify([{ sku: "CUP-PET-16", cases: 4 }, { sku: "HBG-96N", cases: 2 }, { sku: "KFT-1K", cases: 1 }])));
      await p.goto(BASE + "/list"); await p.waitForSelector("text=Ordering for Kebab House");
      await p.screenshot({ path: path.join(SHOTS, "portal-list.png"), fullPage: true });
    }
    await ctx.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
})();
