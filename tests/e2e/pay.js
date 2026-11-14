// Paying for an order from its pay link, end to end, against the mock's stand-ins for Supabase and Stripe.
// The browser loads tests/e2e/fake-stripe.js in place of Stripe.js; its calls to api.stripe.com reach the mock.
// Run against a server started with the Stripe test keys in tests/README.md. With PAYMENTS_OFF=true, against one
// started without them: the pay link, the Pay now button and the pay link in the team's email are not there.
const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE ?? "http://localhost:3123";
const MOCK = process.env.MOCK ?? "http://127.0.0.1:54321";
const OFF = process.env.PAYMENTS_OFF === "true";
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_test_mock";
const FAKE_STRIPE = fs.readFileSync(path.join(__dirname, "fake-stripe.js"), "utf8");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let fails = 0;
let passes = 0;
const check = (cond, msg) => {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (cond) passes++;
  else fails++;
};
async function axe(p, label) {
  await p.addScriptTag({ content: axeSrc });
  const r = await p.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  const hs = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const v = r.violations.map((x) => `${x.impact} ${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")}`);
  check(v.length === 0 && !hs, `axe ${label}${v.length ? " -> " + v.join(" | ") : ""}${hs ? " HSCROLL" : ""}`);
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const mock = async (p, body) => (await (body === undefined ? fetch(MOCK + p) : post(MOCK + p, body))).json();
const newOrder = (body = {}) => mock("/__test/order", body);
const orderIn = (n) => mock(`/__test/order?number=${n}`);
const stripeLog = () => mock("/__test/stripe");
const lastCall = async () => (await stripeLog()).intents.at(-1);
const teamEmails = () => mock("/__test/emails");
const emailsAbout = async (n) => (await teamEmails()).filter((e) => e.subject.includes(`order ${n},`) || e.subject.includes(`Order ${n},`));
const settle = async (pi, outcome) =>
  (await post(`${MOCK}/stripe/__settle/${pi}`, { outcome }, { Authorization: "Bearer sk_test_mock" })).json();

/** A Stripe event sent to the site's webhook, signed the way Stripe signs it. */
async function webhook(type, object, { livemode = false, secret = WHSEC, at = Math.floor(Date.now() / 1000), header } = {}) {
  const payload = JSON.stringify({ id: "evt_" + crypto.randomUUID().replace(/-/g, ""), object: "event", type, livemode, data: { object } });
  const sig = crypto.createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex");
  const res = await fetch(BASE + "/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(header === null ? {} : { "Stripe-Signature": header ?? `t=${at},v1=${sig}` }) },
    body: payload,
  });
  return res.status;
}

/** Stripe.js and its calls answered by the tests and the mock; everything else from the site. */
async function stripeRoutes(ctx) {
  // Routing every request switches the browser's own cache off (see tests/README.md).
  await ctx.route("**/*", (route) => route.continue());
  await ctx.route("https://js.stripe.com/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/endive/stripe.js") return route.fulfill({ contentType: "application/javascript", body: FAKE_STRIPE });
    if (pathname === "/fake/payment-element.html") {
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang=en><title>Payment details</title><p>Card or bank account</p></html>" });
    }
    return route.abort();
  });
  await ctx.route("https://api.stripe.com/**", async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const res = await fetch(`${MOCK}/stripe/js${pathname}`, {
      method: req.method(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: req.postData() ?? undefined,
    });
    return route.fulfill({ status: res.status, contentType: "application/json", body: await res.text(), headers: { "Access-Control-Allow-Origin": "*" } });
  });
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

const box = "section[aria-labelledby=pay-box-title]";
const boxText = async (p) => (await p.innerText(box)).replace(/\s+/g, " ");
/** Opens a pay link and waits until Stripe's form can be used. */
async function openPay(p, token, prefix = "") {
  const res = await p.goto(`${BASE}${prefix}/pay/${token}`);
  await p.waitForFunction(() => {
    const b = document.querySelector("section[aria-labelledby=pay-box-title] form button[type=submit]");
    return b && !b.disabled;
  });
  return res;
}
/** Picks what the customer typed into Stripe's form, then asks for the review. */
async function review(p, scenario, wait = "check") {
  await p.evaluate((s) => {
    window.__stripeScenario = s;
  }, scenario);
  await p.click(`${box} button[type=submit]`);
  if (wait === "check") await p.waitForSelector(`${box} h2:text-is("Check your payment")`);
}
async function payNow(p, done = /Paid\. Thank you\.|Your bank payment is on its way/) {
  await p.click(`${box} button:has-text("Pay $")`);
  await p.waitForFunction((src) => new RegExp(src).test(document.querySelector("section[aria-labelledby=pay-box-title]").innerText), done.source);
}

(async () => {
  const b = await chromium.launch();
  const blocked = [];
  const errors = [];
  const watch = (p) => {
    p.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) blocked.push(m.text().slice(0, 160));
    });
    p.on("pageerror", (e) => errors.push(e.message));
  };

  if (OFF) {
    // Payments switched off (no Stripe keys): nothing about paying shows, and the webhook is not there.
    const o = await newOrder();
    const res = await fetch(`${BASE}/pay/${o.pay_token}`);
    check(res.status === 404, `off: a pay link is not found while payments are off (${res.status})`);
    check((await webhook("payment_intent.succeeded", {})) === 404, "off: the webhook is not there");
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route("**/*", (route) => route.continue());
    const p = await ctx.newPage();
    watch(p);
    await signIn(p, "owner@kebab.test");
    await p.goto(`${BASE}/account/orders/${o.number}`);
    const text = await p.innerText("main");
    check(!text.includes("Pay now") && !text.includes("Not paid yet"), "off: the order page offers no payment");
    await p.evaluate(() => localStorage.setItem("mor.list.v1", JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])));
    await p.goto(BASE + "/list");
    await p.waitForSelector("text=Ordering for Kebab House");
    await p.click("button:has-text('Place order')");
    await p.waitForSelector("text=/Order \\d+ is in/");
    const n = (await p.textContent("h2")).match(/\d+/)[0];
    const mail = (await teamEmails()).find((e) => e.subject === `New order ${n}: Kebab House`);
    check(Boolean(mail) && !mail.text.includes("Pay link"), "off: the team's order email has no pay link");
    const policy = (await p.request.get(BASE + "/")).headers()["content-security-policy"] ?? "";
    check(!policy.includes("stripe"), "off: pages other than the pay page keep Stripe out of their policy");
    check(blocked.length === 0, `off: the content security policy blocked nothing ${blocked.join(" | ")}`);
    await b.close();
    console.log(`${passes} passed, ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }

  // ───────── The owner places an order: the team's email has its pay link, the order page offers to pay. ─────────
  const owner = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await stripeRoutes(owner);
  const op = await owner.newPage();
  watch(op);
  await signIn(op, "owner@kebab.test");
  await op.evaluate(() => localStorage.setItem("mor.list.v1", JSON.stringify([{ sku: "CUP-PET-16", cases: 2 }])));
  await op.goto(BASE + "/list");
  await op.waitForSelector("text=Ordering for Kebab House");
  check((await op.innerText("aside")).includes("Paying by credit card adds 2.9%. Bank payments and debit cards have no fee."), "the list says the credit card fee is 2.9%");
  await op.click("button:has-text('Place order')");
  await op.waitForSelector("text=/Order \\d+ is in/");
  const N1 = (await op.textContent("h2")).match(/\d+/)[0];
  const O1 = await orderIn(N1);
  const T1 = O1.pay_token;
  const placedMail = (await teamEmails()).find((e) => e.subject === `New order ${N1}: Kebab House`);
  check(
    Boolean(placedMail) && placedMail.text.includes(`Pay link (text it to the customer at delivery): https://morsupply.com/pay/${T1}`),
    `the team's order email carries the order's pay link (${placedMail?.text.split("\n").pop()})`,
  );
  await op.goto(`${BASE}/account/orders/${N1}`);
  let main = (await op.innerText("main")).replace(/\s+/g, " ");
  check(main.includes("Payment Not paid yet."), "the order page says the order is not paid yet");
  const payHref = await op.getAttribute("main a:has-text('Pay now')", "href");
  check(payHref === `/pay/${T1}`, `the order page's Pay now opens the order's pay link (${payHref})`);
  await axe(op, "1280 order page with Pay now");

  // ───────── The customer pays on a phone, signed out: a credit card, with the fee shown before paying. ─────────
  const phone = await b.newContext({ viewport: { width: 390, height: 844 } });
  await stripeRoutes(phone);
  const p = await phone.newPage();
  watch(p);
  let res = await openPay(p, T1);
  check(res.status() === 200, `the pay link opens for anyone who has it (${res.status()})`);
  const csp = res.headers()["content-security-policy"] ?? "";
  check(
    csp.includes("script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com") &&
      csp.includes("frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com") &&
      csp.includes("connect-src 'self' https://api.stripe.com") &&
      csp.includes("frame-ancestors 'none'") &&
      csp.includes("form-action 'self'"),
    `the pay page's policy lets in Stripe and nothing else new (${csp})`,
  );
  const homePolicy = (await p.request.get(BASE + "/")).headers()["content-security-policy"] ?? "";
  check(homePolicy.includes("default-src 'self'") && !homePolicy.includes("stripe"), "other pages keep Stripe out of their policy");
  check((await p.getAttribute("meta[name=robots]", "content"))?.includes("noindex"), "search engines are told not to index pay pages");
  check((await p.title()).startsWith(`Pay for order ${N1}`), `the page is titled for the order (${await p.title()})`);
  let text = await boxText(p);
  check(text.includes("Amount due $156.66") && text.includes("How would you like to pay?"), `it shows the amount due first (${text.slice(0, 80)})`);
  check(text.includes("Paying by credit card adds 2.9%. Bank payments and debit cards have no fee."), "the fee is disclosed before the customer picks how to pay");
  check(text.includes("Test mode: no real money moves."), "test keys say so on the page");
  const items = (await p.innerText("section[aria-labelledby=pay-items]")).replace(/\s+/g, " ");
  check(items.includes("Clear cold cups") && items.includes("2 cases") && items.includes("$106.66") && items.includes("Delivery $50.00") && items.includes("Total $156.66"), `it lists what the order holds (${items})`);
  const opts = await p.evaluate(() => ({ elements: window.__stripeElements, element: window.__stripeElementOptions, key: window.__stripeKey }));
  check(
    opts.key === "pk_test_mock" &&
      opts.elements.mode === "payment" &&
      opts.elements.amount === 15666 &&
      opts.elements.currency === "usd" &&
      JSON.stringify(opts.elements.allowedPaymentMethodTypes) === JSON.stringify(["card", "us_bank_account"]) &&
      opts.elements.paymentMethodOptions?.us_bank_account?.verification_method === "instant" &&
      opts.elements.locale === "en",
    `Stripe's form is set up for card and bank, in English, for the amount due: ${JSON.stringify(opts.elements)}`,
  );
  check(
    opts.element?.wallets?.applePay === "never" && opts.element?.wallets?.googlePay === "never" && opts.element?.wallets?.link === "never",
    "no Apple Pay, Google Pay or Link: they show an amount before the card fee is known",
  );
  await axe(p, "390 pay form");

  // A field left empty: Stripe's form says so in its own field, and nothing goes to the server.
  const tokensBefore = (await stripeLog()).tokens.length;
  await review(p, "incomplete", "none");
  await p.waitForFunction(() => !document.querySelector("section[aria-labelledby=pay-box-title] form button[type=submit]").disabled);
  check((await stripeLog()).tokens.length === tokensBefore && !(await p.$(`${box} [role=alert]`)), "an empty field keeps the customer on the form, with nothing sent");

  await review(p, "credit");
  text = await boxText(p);
  check(
    text.includes("Visa credit card ending in 4242") &&
      text.includes("Order total $156.66") &&
      text.includes("Credit card fee (2.9%) $4.54") &&
      text.includes("You pay $161.20") &&
      text.includes("Pay $161.20") &&
      text.includes("Change payment method"),
    `the review shows the card, the 2.9% fee and the total before paying (${text})`,
  );
  check(await p.evaluate(() => document.activeElement?.textContent === "Check your payment"), "focus moves to the review");
  check((await stripeLog()).intents.filter((c) => c.params["metadata[order_number]"] === N1).length === 0, "nothing is charged by reviewing");
  await axe(p, "390 pay review");
  await payNow(p);
  text = await boxText(p);
  check(text.includes("Paid. Thank you.") && text.includes("Paid $161.20") && text.includes("Credit card fee (2.9%) $4.54") && text.includes("Visa credit card ending in 4242"), `the customer sees it went through (${text})`);
  check(!text.includes("Amount due"), "once paid, nothing reads as still due");
  check(await p.evaluate(() => document.activeElement?.textContent === "Paid. Thank you."), "focus moves to the answer");
  let call = await lastCall();
  check(
    call.params.amount === "16120" &&
      call.params.currency === "usd" &&
      call.params.confirm === "true" &&
      call.params.confirmation_token?.startsWith("ctoken_credit_") &&
      call.params["amount_details[surcharge][amount]"] === "454" &&
      call.params["amount_details[surcharge][enforce_validation]"] === "enabled" &&
      call.version === "2026-03-25.preview" &&
      call.params["payment_method_options[us_bank_account][verification_method]"] === "instant" &&
      call.params["metadata[order_number]"] === N1 &&
      call.params["metadata[order_id]"] === O1.id &&
      call.params["metadata[method]"] === "credit_card" &&
      call.params["metadata[card_fee]"] === "454" &&
      call.params["metadata[amount_due]"] === "15666" &&
      call.params.description === `MOR Supply order ${N1}` &&
      call.params.return_url === `https://morsupply.com/pay/${T1}` &&
      call.idempotencyKey === `mor-pay-${O1.id}-${call.params.confirmation_token}`,
    `the server charges 156.66 + 4.54 with the fee sent as Stripe's surcharge: ${JSON.stringify(call)}`,
  );
  let o = await orderIn(N1);
  check(o.payment_status === "paid" && o.payment_method === "credit_card" && o.card_fee === 4.54 && o.payment_amount === 161.2 && o.stripe_payment_intent === call.intent, `the order is recorded paid: ${JSON.stringify({ s: o.payment_status, m: o.payment_method, f: o.card_fee, a: o.payment_amount })}`);
  let mails = await emailsAbout(N1);
  check(
    mails.length === 1 && mails[0].subject === `Paid: order ${N1}, Kebab House, $161.20` && mails[0].text.includes("$161.20 by credit card") && mails[0].text.includes("Includes the credit card fee: $4.54 on $156.66") && mails[0].text.includes(call.intent),
    `the team hears it was paid, with the fee (${mails.map((m) => m.subject).join(" | ")})`,
  );
  await axe(p, "390 pay done");
  // Stripe's webhook brings the same news: nothing changes and no second email.
  check((await webhook("payment_intent.succeeded", { id: call.intent, object: "payment_intent", status: "succeeded", amount: 16120, amount_received: 16120, livemode: false, metadata: { order_id: O1.id, method: "credit_card", card_fee: "454" } })) === 200, "the webhook takes the same news");
  check((await emailsAbout(N1)).length === 1, "and the team gets no second email");
  // Opening the link again says it is paid, and offers nothing to pay.
  await p.goto(`${BASE}/pay/${T1}`);
  text = await boxText(p);
  check(text.includes("Paid. Thank you.") && /\$161\.20 paid by credit card on \w{3} \d{1,2}, \d{4}\./.test(text) && text.includes("Includes a $4.54 credit card fee.") && !(await p.$(`${box} form`)), `a paid order's link says so (${text})`);
  await axe(p, "390 pay link of a paid order");
  // The owner's order page says the same, and no longer offers to cancel.
  await op.goto(`${BASE}/account/orders/${N1}`);
  main = (await op.innerText("main")).replace(/\s+/g, " ");
  check(/Payment \$161\.20 paid by credit card on \w{3} \d{1,2}, \d{4}\. Includes a \$4\.54 credit card fee\./.test(main) && !main.includes("Pay now") && !main.includes("Cancel this order"), `the order page shows the payment and offers no cancel (${main.slice(main.indexOf("Payment"), main.indexOf("Payment") + 120)})`);

  // ───────── A bank payment: no fee, on its way, then in by the webhook a few days later. ─────────
  const B = await newOrder({ lines: [{ sku: "HBG-96N", cases: 1 }] });
  await openPay(p, B.pay_token);
  await review(p, "bank");
  text = await boxText(p);
  check(text.includes("Bank account ending in 6789") && text.includes("Order total $94.44") && !text.includes("Credit card fee") && text.includes("You pay $94.44"), `a bank payment has no fee (${text})`);
  await payNow(p);
  text = await boxText(p);
  check(text.includes("Your bank payment is on its way") && text.includes("It takes about 4 business days to clear.") && text.includes("You pay $94.44"), `a bank payment says it is on its way (${text})`);
  call = await lastCall();
  check(
    call.params.amount === "9444" && call.params["amount_details[surcharge][amount]"] === undefined && call.version === "2026-10-28.endive" && call.params.receipt_email === "ali@kebab.test" && call.params["metadata[method]"] === "bank" && call.params["metadata[card_fee]"] === "0",
    `a bank payment goes without a surcharge, on the pinned API version, with a receipt to the account holder: ${JSON.stringify(call)}`,
  );
  o = await orderIn(B.number);
  check(o.payment_status === "processing" && o.payment_method === "bank" && o.card_fee === 0, `the order reads processing (${o.payment_status})`);
  mails = await emailsAbout(B.number);
  check(mails.length === 1 && mails[0].subject === `Bank payment on its way: order ${B.number}, Kebab House, $94.44`, `the team hears a bank payment started (${mails.map((m) => m.subject).join(" | ")})`);
  await p.goto(`${BASE}/pay/${B.pay_token}`);
  text = await boxText(p);
  check(text.includes("Your bank payment is on its way") && /\$94\.44 from a bank account, started on \w{3} \d{1,2}, \d{4}\./.test(text) && !(await p.$(`${box} form`)), `the link says a bank payment is on its way (${text})`);
  await axe(p, "390 pay link with a bank payment on its way");
  await op.goto(`${BASE}/account/orders/${B.number}`);
  main = (await op.innerText("main")).replace(/\s+/g, " ");
  check(main.includes("from a bank account, started on") && !main.includes("Pay now") && !main.includes("Cancel this order"), "the order page shows the bank payment on its way, with no cancel");
  // Days later the bank payment clears: Stripe's webhook marks the order paid.
  const cleared = await settle(call.intent, "succeed");
  check((await webhook("payment_intent.succeeded", cleared)) === 200, "the webhook takes a cleared bank payment");
  o = await orderIn(B.number);
  check(o.payment_status === "paid" && o.payment_amount === 94.44 && Boolean(o.paid_at), `the order is paid once the bank payment clears (${o.payment_status})`);
  mails = await emailsAbout(B.number);
  check(mails.length === 2 && mails[1].subject === `Paid: order ${B.number}, Kebab House, $94.44` && mails[1].text.includes("by bank (ACH)"), `the team hears it cleared (${mails.map((m) => m.subject).join(" | ")})`);
  check((await webhook("payment_intent.processing", { ...cleared, status: "processing" })) === 200 && (await orderIn(B.number)).payment_status === "paid", "a late 'on its way' leaves it paid");
  check((await emailsAbout(B.number)).length === 2, "and sends nothing");

  // ───────── A bank payment that fails: the team hears, and the same link takes a new payment. ─────────
  const F = await newOrder({ lines: [{ sku: "POR-020C", cases: 3 }] }); // 3 x 33.33 + 50 = 149.99
  await openPay(p, F.pay_token);
  await review(p, "bank");
  await payNow(p);
  const failedPi = (await lastCall()).intent;
  const bounced = await settle(failedPi, "fail");
  check((await webhook("payment_intent.payment_failed", bounced)) === 200, "the webhook takes a failed bank payment");
  o = await orderIn(F.number);
  check(o.payment_status === "failed", `the order reads failed (${o.payment_status})`);
  mails = await emailsAbout(F.number);
  const failMail = mails.find((m) => m.subject === `Payment failed: order ${F.number}, Kebab House`);
  check(
    Boolean(failMail) && failMail.text.includes("Stripe says: The customer's account has insufficient funds") && failMail.text.includes(`https://morsupply.com/pay/${F.pay_token}`),
    `the team hears it failed, with the link to send again (${failMail?.text.replace(/\n/g, " / ")})`,
  );
  await op.goto(`${BASE}/account/orders/${F.number}`);
  main = (await op.innerText("main")).replace(/\s+/g, " ");
  check(main.includes("Your last payment didn’t go through. You can pay again.") && main.includes("Pay now"), "the order page says the payment failed and offers to pay again");
  await openPay(p, F.pay_token);
  text = await boxText(p);
  check(text.includes("Your last payment didn’t go through. You can pay again.") && text.includes("Amount due $149.99"), `the link says the last payment failed and takes a new one (${text.slice(0, 120)})`);
  await review(p, "debit");
  text = await boxText(p);
  check(text.includes("Visa debit card ending in 5556") && !text.includes("Credit card fee") && text.includes("Pay $149.99"), "a debit card has no fee");
  await payNow(p);
  o = await orderIn(F.number);
  check(o.payment_status === "paid" && o.payment_method === "debit_card" && o.card_fee === 0, `paying again after a failure works (${o.payment_method})`);
  check(!(await boxText(p)).includes("didn’t go through"), "and the note about the failed payment goes once it does");
  check((await webhook("payment_intent.payment_failed", bounced)) === 200 && (await orderIn(F.number)).payment_status === "paid", "news about the old failed payment leaves the order paid");

  // ───────── A declined card, then a credit card from abroad (no fee: the fee is for US credit cards). ─────────
  const D = await newOrder();
  await openPay(p, D.pay_token);
  await review(p, "decline");
  check((await boxText(p)).includes("Credit card fee (2.9%) $4.54"), "a credit card is reviewed with its fee");
  await p.click(`${box} button:has-text("Pay $161.20")`);
  await p.waitForSelector(`${box} [role=alert]`);
  text = await boxText(p);
  check(text.includes("Your card was declined. Try another card, or pay from a bank account.") && text.includes("How would you like to pay?"), `a declined card says so and goes back to the form (${text})`);
  check(await p.evaluate(() => document.activeElement?.textContent === "How would you like to pay?"), "focus goes back to the form");
  o = await orderIn(D.number);
  check(o.payment_status === "unpaid" && (await emailsAbout(D.number)).length === 0, "a declined card leaves the order unpaid and the team undisturbed");
  const declinedPi = (await lastCall()).intent;
  await review(p, "foreign");
  text = await boxText(p);
  check(text.includes("Visa credit card ending in 0002") && !text.includes("Credit card fee") && text.includes("Pay $156.66"), "a credit card issued abroad has no fee");
  await payNow(p);
  call = await lastCall();
  check(call.params["amount_details[surcharge][amount]"] === undefined && call.params.amount === "15666" && (await orderIn(D.number)).payment_method === "credit_card", "and is charged the order total, no surcharge");
  check((await webhook("payment_intent.payment_failed", { id: declinedPi, object: "payment_intent", status: "requires_payment_method", amount: 16120, livemode: false, metadata: { order_id: D.id }, last_payment_error: { type: "card_error", message: "Your card was declined." } })) === 200, "the webhook takes news of the declined card");
  check((await orderIn(D.number)).payment_status === "paid" && !(await emailsAbout(D.number)).some((m) => m.subject.startsWith("Payment failed")), "which leaves the order paid and sends nothing");

  // ───────── A card that asks the customer to confirm (3D Secure). ─────────
  const S = await newOrder();
  await openPay(p, S.pay_token);
  await review(p, "3ds");
  await payNow(p);
  check((await p.evaluate(() => window.__stripeNextActions)) === 1 && (await boxText(p)).includes("Paid. Thank you."), "a card that asks the customer to confirm goes through once they do");
  check((await orderIn(S.number)).payment_status === "paid", "and is recorded paid");
  const S2 = await newOrder();
  await openPay(p, S2.pay_token);
  await review(p, "3ds_fail");
  await p.click(`${box} button:has-text("Pay $")`);
  await p.waitForSelector(`${box} [role=alert]`);
  check((await boxText(p)).includes("Your card was declined.") && (await orderIn(S2.number)).payment_status === "unpaid", "a card the customer could not confirm is declined, and the order stays unpaid");

  // ───────── The amount changes between the review and Pay: the customer sees the new amount first. ─────────
  const C = await newOrder();
  await openPay(p, C.pay_token);
  await review(p, "credit");
  await mock("/__test/order-amount", { number: C.number, subtotal: 100, total: 150 });
  await p.click(`${box} button:has-text("Pay $161.20")`);
  await p.waitForSelector(`${box} button:has-text("Pay $154.35")`);
  text = await boxText(p);
  check(text.includes("The amount changed. Check it, then pay.") && text.includes("Order total $150.00") && text.includes("Credit card fee (2.9%) $4.35"), `a changed amount is shown before anything is charged (${text})`);
  check(!(await stripeLog()).intents.some((c) => c.params["metadata[order_number]"] === String(C.number)), "nothing was charged at the old amount");
  await payNow(p);
  call = await lastCall();
  check(call.params.amount === "15435" && call.params["amount_details[surcharge][amount]"] === "435", `the new amount is what is charged (${call.params.amount})`);

  // ───────── Details that expired, then a change of mind: card, then bank. ─────────
  const E = await newOrder();
  await openPay(p, E.pay_token);
  await p.evaluate(() => {
    window.__stripeExpired = true;
  });
  await review(p, "credit", "none");
  await p.waitForSelector(`${box} [role=alert]`);
  check((await boxText(p)).includes("Enter your payment details again."), "expired details are asked for again");
  await p.evaluate(() => {
    window.__stripeExpired = false;
  });
  await review(p, "credit");
  await p.click(`${box} button:has-text("Change payment method")`);
  await p.waitForSelector(`${box} form:not([hidden])`);
  check(await p.evaluate(() => document.activeElement?.textContent === "How would you like to pay?"), "Change payment method goes back to the form");
  await review(p, "bank");
  check((await boxText(p)).includes("Bank account ending in 6789"), "and the new choice is reviewed");
  await payNow(p);
  check((await orderIn(E.number)).payment_status === "processing", "the bank payment goes through");

  // ───────── Links that cannot be paid: canceled, a price to confirm, unknown. ─────────
  const X = await newOrder({ status: "canceled" });
  await p.goto(`${BASE}/pay/${X.pay_token}`);
  text = await boxText(p);
  check(text === `Payment Order ${X.number} was canceled. There’s nothing to pay.` && !(await p.$(`${box} form`)), `a canceled order has nothing to pay (${text})`);
  await axe(p, "390 pay link of a canceled order");
  const U = await newOrder({ lines: [{ sku: "KFT-1K", cases: 1 }] });
  await p.goto(`${BASE}/pay/${U.pay_token}`);
  text = await boxText(p);
  check(text.includes("The total for this order isn’t confirmed yet.") && !(await p.$(`${box} form`)), `an order with a price to confirm cannot be paid yet (${text})`);
  check((await fetch(`${BASE}/pay/${crypto.randomUUID()}`)).status === 404, "an unknown pay link is not found");
  check((await fetch(`${BASE}/pay/not-a-token`)).status === 404, "a malformed pay link is not found");

  // ───────── Spanish, Turkish and Arabic. ─────────
  const L = await newOrder({ locale: "es" });
  await openPay(p, L.pay_token, "/es");
  check((await p.textContent("h1")) === `Pagar el pedido ${L.number}` && (await p.evaluate(() => window.__stripeElements.locale)) === "es", "the pay page and Stripe's form speak Spanish");
  await review(p, "credit", "none");
  await p.waitForSelector(`${box} h2:text-is("Revise su pago")`);
  text = await boxText(p);
  check(text.includes("Tarjeta de crédito Visa terminada en 4242") && text.includes("Cargo por tarjeta de crédito (2.9%) $4.54") && text.includes("Pagar $161.20"), `the review in Spanish (${text})`);
  const T = await newOrder({ locale: "tr" });
  await openPay(p, T.pay_token, "/tr");
  await review(p, "credit", "none");
  await p.waitForSelector(`${box} h2:text-is("Ödemenizi kontrol edin")`);
  text = await boxText(p);
  check(text.includes("Son dört hanesi 4242 olan Visa kredi kartı") && text.includes("Kredi kartı ücreti (%2,9) $4.54") && text.includes("$161.20 öde"), `the review in Turkish (${text})`);
  const A = await newOrder({ locale: "ar" });
  await openPay(p, A.pay_token, "/ar");
  check((await p.getAttribute("html", "dir")) === "rtl" && (await p.evaluate(() => window.__stripeElements.locale)) === "ar", "the Arabic pay page reads right to left, and Stripe's form speaks Arabic");
  await axe(p, "390 pay form in Arabic");
  await review(p, "credit", "none");
  await p.waitForSelector(`${box} h2:text-is("راجع دفعتك")`);
  text = await boxText(p);
  check(text.includes("بطاقة ائتمان") && text.includes("4242") && text.includes("رسوم بطاقة الائتمان (2.9%)") && text.includes("$4.54"), `the review in Arabic (${text})`);
  await axe(p, "390 pay review in Arabic");

  // ───────── Wide screens. ─────────
  const wide = await owner.newPage();
  watch(wide);
  const W = await newOrder();
  await openPay(wide, W.pay_token);
  const boxes = await wide.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { pay: r("section[aria-labelledby=pay-box-title]"), items: r("section[aria-labelledby=pay-items]") };
  });
  check(boxes.pay.left > boxes.items.left && Math.abs(boxes.pay.top - boxes.items.top) < 2, "on a wide screen paying sits beside what the order holds");
  await axe(wide, "1280 pay form");

  // ───────── The webhook: signatures, the other mode, retries, payments from elsewhere, disputes. ─────────
  const H = await newOrder();
  const paidNews = { id: "pi_hook_1", object: "payment_intent", status: "succeeded", amount: 15666, amount_received: 15666, livemode: false, metadata: { order_id: H.id, order_number: String(H.number), method: "bank", card_fee: "0" } };
  check((await webhook("payment_intent.succeeded", paidNews, { secret: "whsec_wrong" })) === 400, "a webhook signed with another secret is refused");
  check((await webhook("payment_intent.succeeded", paidNews, { header: null })) === 400, "a webhook with no signature is refused");
  check((await webhook("payment_intent.succeeded", paidNews, { at: Math.floor(Date.now() / 1000) - 3600 })) === 400, "an old webhook (a replay) is refused");
  check((await webhook("payment_intent.succeeded", paidNews, { livemode: true })) === 200 && (await orderIn(H.number)).payment_status === "unpaid", "a live event leaves a test site's orders alone");
  check((await orderIn(H.number)).payment_status === "unpaid", "none of those changed the order");
  await mock("/__test/fail-payments", { times: 1 });
  check((await webhook("payment_intent.succeeded", paidNews)) === 500, "when the database cannot be reached the webhook answers 500, so Stripe sends it again");
  check((await webhook("payment_intent.succeeded", paidNews)) === 200 && (await orderIn(H.number)).payment_status === "paid", "and the retry records it");
  check((await webhook("payment_intent.succeeded", { id: "pi_dashboard_1", object: "payment_intent", status: "succeeded", amount: 500, livemode: false, metadata: {} })) === 200, "a payment made elsewhere (the Dashboard) is acknowledged and left alone");
  const twice = { ...paidNews, id: "pi_hook_2", metadata: { ...paidNews.metadata, method: "credit_card", card_fee: "454" }, amount: 16120, amount_received: 16120 };
  check((await webhook("payment_intent.succeeded", twice)) === 200, "a second payment for a paid order is taken");
  mails = await emailsAbout(H.number);
  const twiceMail = mails.find((m) => m.subject === `Paid twice? Order ${H.number}, Kebab House`);
  check(Boolean(twiceMail) && twiceMail.text.includes("refund one of them") && twiceMail.text.includes("pi_hook_2"), `and the team is told to refund one (${mails.map((m) => m.subject).join(" | ")})`);
  const disputed = await webhook("charge.dispute.created", { id: "dp_1", object: "dispute", amount: 16120, reason: "insufficient_funds", payment_intent: call.intent, livemode: false });
  const disputeMail = (await teamEmails()).find((m) => m.subject.startsWith("Payment disputed:"));
  check(disputed === 200 && Boolean(disputeMail) && disputeMail.subject === `Payment disputed: order ${C.number}, Kebab House, $161.20` && disputeMail.text.includes("insufficient funds"), `a dispute reaches the team (${disputeMail?.subject})`);

  check(blocked.length === 0, `the content security policy blocked nothing in the whole run ${blocked.join(" | ")}`);
  check(errors.length === 0, `no script errors in the whole run ${errors.join(" | ")}`);
  await b.close();
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
