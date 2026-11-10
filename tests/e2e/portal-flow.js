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
const setList = (p, lines) => p.evaluate((l) => localStorage.setItem("mor.list.v1", JSON.stringify(l)), lines);

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
    check((await p.textContent("main")).includes("Your prices show on your list"), `${tag} priced account message`);
    if (tag === 1280) {
      await p.waitForTimeout(400);
      check((await p.textContent("header")).includes("Your account"), `${tag} header switches to Your account`);
      check(!(await p.textContent("header")).includes("Create account"), `${tag} header hides Create account once signed in`);
    }
    await axe(p, `${tag} account home (empty)`);

    // List: prices at a 25% margin, delivery fee, next-day option, card fee note
    await setList(p, LIST);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    let listText = await p.textContent("main");
    check(listText.includes("$53.33 a case") && listText.includes("$44.44 a case") && listText.includes("To be confirmed"), `${tag} per-case prices (cost / 0.75) and unpriced item on the list`);
    check(listText.includes("$302.20"), `${tag} subtotal of priced lines (4 x 53.33 + 2 x 44.44 = 302.20)`);
    check(listText.includes("Delivery") && listText.includes("$50.00"), `${tag} delivery fee shown before ordering`);
    check(listText.includes("Paying by credit card adds 3%"), `${tag} card fee note`);
    check(!listText.includes("$352.20"), `${tag} no total while an item has no price`);
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
    await signOut(p);
    await p.goto(BASE + "/account");
    check(p.url().includes("/account/sign-in"), `${tag} signed out`);

    // Signed out, the list asks people to sign in to order
    await setList(p, [{ sku: "CUP-PET-16", cases: 1 }]);
    await p.goto(BASE + "/list");
    check((await p.textContent("aside")).includes("Sign in to order") && !(await p.textContent("main")).includes("$"), `${tag} signed-out list asks to sign in, no prices`);

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
    check((await p.textContent("main")).includes("Your prices show on your list"), `${tag} new account sees prices`);
    await setList(p, [{ sku: "HBG-96N", cases: 1 }]);
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Pho Place");
    check((await p.textContent("main")).includes("$44.44 a case") && (await p.textContent("aside")).includes("$94.44"), `${tag} new account can order at the same prices`);
    await signOut(p);

    // /request-account now starts sign-up
    await p.goto(BASE + "/request-account");
    await p.waitForSelector("#si-email");
    check(p.url().includes("/account/sign-in?new=1") && (await p.textContent("h1")) === "Create your account", `${tag} request page opens account creation`);

    // A switched-off account
    await signIn(p, "paused@spot.test");
    check((await p.textContent("h1")).includes("paused"), `${tag} switched-off account sees the paused message`);
    await axe(p, `${tag} paused account`);
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
