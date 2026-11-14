// A tiny stand-in for Supabase Auth + PostgREST, enough to drive the portal UI end to end.
import http from "node:http";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USERS = {
  "owner@kebab.test": { id: "11111111-1111-1111-1111-111111111111", accounts: ["A"] },
  // Staff who order for Kebab House: can order and cancel, cannot change the business details.
  "buyer@kebab.test": { id: "33333333-3333-3333-3333-333333333333", accounts: ["A"], roles: { A: "buyer" } },
  "paused@spot.test": { id: "22222222-2222-2222-2222-222222222222", accounts: ["P"] },
};
const ACCOUNTS = {
  A: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Kebab House", delivery_day: "thu", created_at: "2026-11-01T12:00:00Z", active: true, contact_name: "Ali", phone: "+14045550101", street: "100 Buford Hwy", city: "Doraville", zip: "30340", preferred_language: "en" },
  P: { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Taco Spot", delivery_day: null, created_at: "2026-11-02T12:00:00Z", active: false },
};
// Same rules as public.pricing: price = cost / (1 - margin); fees per order. These are test values: production has
// a 30% margin and no fees since Nov 12, 2026. POST /__test/pricing changes them for a test.
const PRICING = { margin: 0.25, delivery_fee: 50, next_day_fee: 50 };
// SKUs with a cost. The site sells only these, so the rest of the catalog stays hidden.
// The first four carry the prices the portal checks add up; the rest fill out the shelves.
const COSTS = {
  "CUP-PET-16": 40, "LID-DOME-98H": 30, "HBG-96N": 33.33, "POR-020C": 25,
  "HMF-993W": 28, "NDN-W": 21, "KBX-1": 36, "KBX-8": 41, "HOT-08": 27, "HOT-12": 31.5,
  "GCK-1": 18, "MSK-BL": 12, "MOP-24": 45, "CHF-GEL": 39, "CLC-08": 24, "KRB-6": 22,
};
// The server key the site reads priced_skus with. Customers never have it.
const SECRET = "sb_secret_test";
let outage = false; // true: priced_skus answers 503, as when Supabase is down
let failAccounts = 0; // how many create_my_account calls answer 500 before it works again
let failDetails = 0; // the same for update_my_account
let failWeekly = 0; // the same for set_weekly_order
let weeklyLive = false; // pricing.weekly_orders_on: off until the team switches weekly orders on

// 5 pm on a calendar day in Atlanta, as a moment in time (Eastern is 5 or 4 hours behind UTC).
function fivePmEastern(ymd) {
  for (const behind of [5, 4]) {
    const t = new Date(`${ymd}T${17 + behind}:00:00Z`);
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(t);
    if (Number(hour) === 17) return t;
  }
}
// The same rule as public.next_delivery: an order closes at 5 pm Eastern, two days before the delivery date.
function nextDelivery(day, now = new Date()) {
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(day);
  if (weekday < 1) return [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  for (let n = 0; n <= 9; n++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    if (d.getUTCDay() !== weekday) continue;
    const twoBefore = new Date(d);
    twoBefore.setUTCDate(twoBefore.getUTCDate() - 2);
    const closes = fivePmEastern(twoBefore.toISOString().slice(0, 10));
    if (closes > now) return [{ delivery_date: d.toISOString().slice(0, 10), closes_at: closes.toISOString() }];
  }
  return [];
}
// A stand-in for Resend's email API, so the tests can read what the site sends.
const emails = [];
const price = (cost) => Math.round((cost / (1 - PRICING.margin)) * 100) / 100;
const orders = []; const usual = {}; let next = 1001;
const tokens = new Map(); // access token -> email
const user = (email) => ({ id: USERS[email].id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: "2026-11-01T00:00:00Z", app_metadata: { provider: "email" }, user_metadata: USERS[email].meta ?? {}, created_at: "2026-11-01T00:00:00Z" });
function session(email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USERS[email].id, email, exp, aud: "authenticated", role: "authenticated" })}.sig${Math.random().toString(36).slice(2)}`;
  tokens.set(access, email);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-" + email, user: user(email) };
}
// Active accounts only, like public.my_account_ids().
const mine = (email) => (USERS[email]?.accounts ?? []).map((k) => ACCOUNTS[k]).filter((a) => a.active);
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const single = (req, res, rows) =>
  (req.headers.accept || "").includes("vnd.pgrst.object")
    ? rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "0 rows" })
    : send(res, 200, rows);
// ───────── A stand-in for Stripe ─────────
// The fake Stripe.js (tests/e2e/fake-stripe.js) asks for a ConfirmationToken for a scenario, as the real one does
// from the details typed into the Payment Element. Each scenario is a payment method Stripe would report.
const SCENARIOS = {
  credit: { type: "card", card: { brand: "visa", funding: "credit", country: "US", last4: "4242" } },
  debit: { type: "card", card: { brand: "visa", funding: "debit", country: "US", last4: "5556" } },
  prepaid: { type: "card", card: { brand: "mastercard", funding: "prepaid", country: "US", last4: "5100" } },
  foreign: { type: "card", card: { brand: "visa", funding: "credit", country: "GB", last4: "0002" } },
  amex: { type: "card", card: { brand: "amex", funding: "credit", country: "US", last4: "8431" } },
  decline: { type: "card", card: { brand: "visa", funding: "credit", country: "US", last4: "0341" } },
  "3ds": { type: "card", card: { brand: "visa", funding: "credit", country: "US", last4: "3155" } },
  "3ds_fail": { type: "card", card: { brand: "visa", funding: "credit", country: "US", last4: "3184" } },
  bank: { type: "us_bank_account", us_bank_account: { bank_name: "STRIPE TEST BANK", last4: "6789" }, billing_details: { email: "ali@kebab.test", name: "Ali" } },
};
const STRIPE_KEY = "sk_test_mock";
const SURCHARGE_VERSION = "2026-03-25.preview";
const ctokens = new Map(); // id -> ConfirmationToken
const intents = new Map(); // id -> PaymentIntent
const idempotent = new Map(); // Idempotency-Key -> PaymentIntent id
const stripeCalls = []; // what the site sent when it made each payment
let failPayments = 0; // how many set_order_payment calls answer 500 before it works again
let nIntent = 0;
const stripeError = (res, status, error) => send(res, status, { error });
function stripe(req, res, p, body) {
  // Stripe.js in the browser: a token for the details "typed in", and the customer confirming with their card.
  if (p === "/stripe/js/v1/confirmation_tokens" && req.method === "POST") {
    const scenario = SCENARIOS[body.scenario] ? body.scenario : "credit";
    const id = `ctoken_${scenario.replace(/[^a-z0-9]/g, "")}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    ctokens.set(id, {
      id, object: "confirmation_token", livemode: false, scenario, payment_intent: null,
      expires_at: Math.floor(Date.now() / 1000) + (body.expired === "1" ? 30 : 12 * 3600),
      payment_method_preview: { billing_details: { email: null, name: null }, ...SCENARIOS[scenario] },
    });
    return send(res, 200, { id, object: "confirmation_token" });
  }
  const next = p.match(/^\/stripe\/js\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)\/next_action$/);
  if (next) {
    const pi = intents.get(next[1]);
    if (!pi) return stripeError(res, 404, { type: "invalid_request_error", code: "resource_missing", message: "No such payment_intent" });
    if (pi.status === "requires_action") {
      if (pi.scenario === "3ds_fail") Object.assign(pi, { status: "requires_payment_method", last_payment_error: { type: "card_error", code: "payment_intent_authentication_failure", message: "We are unable to authenticate your payment method." } });
      else Object.assign(pi, { status: "succeeded", amount_received: pi.amount, client_secret: pi.client_secret });
    }
    return send(res, 200, { paymentIntent: { id: pi.id, status: pi.status } });
  }
  // The site's server, with the secret key.
  if ((req.headers.authorization || "") !== `Bearer ${STRIPE_KEY}`) return stripeError(res, 401, { type: "invalid_request_error", message: "Invalid API Key provided" });
  const ct = p.match(/^\/stripe\/v1\/confirmation_tokens\/([A-Za-z0-9_]+)$/);
  if (ct && req.method === "GET") {
    const t = ctokens.get(ct[1]);
    if (!t) return stripeError(res, 404, { type: "invalid_request_error", code: "resource_missing", message: "No such confirmationtoken" });
    const { scenario, ...token } = t;
    return send(res, 200, token);
  }
  const got = p.match(/^\/stripe\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/);
  if (got && req.method === "GET") {
    const pi = intents.get(got[1]);
    if (!pi) return stripeError(res, 404, { type: "invalid_request_error", code: "resource_missing", message: "No such payment_intent" });
    const { scenario, ...intent } = pi;
    return send(res, 200, intent);
  }
  if (p === "/stripe/v1/payment_intents" && req.method === "POST") {
    const version = req.headers["stripe-version"] || null;
    const key = req.headers["idempotency-key"] || null;
    const call = { params: body, version, idempotencyKey: key, intent: null };
    stripeCalls.push(call);
    if (key && idempotent.has(key)) {
      const { scenario, ...intent } = intents.get(idempotent.get(key));
      call.intent = intent.id;
      call.replayed = true;
      return send(res, 200, intent);
    }
    const t = ctokens.get(body.confirmation_token);
    if (!t) return stripeError(res, 400, { type: "invalid_request_error", code: "resource_missing", message: "No such confirmationtoken" });
    if (t.payment_intent) return stripeError(res, 400, { type: "invalid_request_error", code: "confirmation_token_already_used", message: "This ConfirmationToken has already been used" });
    if (body.confirm !== "true" || body.currency !== "usd" || !(Number(body.amount) >= 50)) return stripeError(res, 400, { type: "invalid_request_error", message: "confirm, currency usd and an amount of 50 or more are required" });
    if (body.payment_method_types || body["payment_method_types[0]"]) return stripeError(res, 400, { type: "invalid_request_error", code: "parameter_unknown", message: "Received unknown parameter: payment_method_types" });
    // The surcharge, as Stripe's public preview takes it: on US credit cards, at most 3%, under the preview version.
    const surcharge = body["amount_details[surcharge][amount]"];
    if (surcharge != null) {
      if (version !== SURCHARGE_VERSION) return stripeError(res, 400, { type: "invalid_request_error", code: "parameter_unknown", message: "Received unknown parameter: amount_details[surcharge]" });
      const card = t.payment_method_preview.card;
      const base = Number(body.amount) - Number(surcharge);
      if (body["amount_details[surcharge][enforce_validation]"] !== "enabled" || card?.funding !== "credit" || card?.country !== "US" || Number(surcharge) > Math.floor(base * 0.03)) {
        return stripeError(res, 400, { type: "invalid_request_error", code: "amount_details_surcharge_invalid", message: "Surcharging is not available for this payment" });
      }
    }
    const id = `pi_mock_${++nIntent}`;
    const metadata = Object.fromEntries(Object.entries(body).filter(([k]) => k.startsWith("metadata[")).map(([k, v]) => [k.slice(9, -1), v]));
    const pi = { id, object: "payment_intent", amount: Number(body.amount), amount_received: 0, currency: "usd", livemode: false, client_secret: `${id}_secret_mock`, metadata, last_payment_error: null, scenario: t.scenario, status: "succeeded" };
    t.payment_intent = id;
    call.intent = id;
    intents.set(id, pi);
    if (key) idempotent.set(key, id);
    if (t.scenario === "decline") {
      Object.assign(pi, { status: "requires_payment_method", last_payment_error: { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined." } });
      const { scenario, ...intent } = pi;
      return stripeError(res, 402, { type: "card_error", code: "card_declined", decline_code: "generic_decline", message: "Your card was declined.", payment_intent: intent });
    }
    if (t.scenario === "bank") pi.status = "processing";
    else if (t.scenario.startsWith("3ds")) Object.assign(pi, { status: "requires_action", next_action: { type: "use_stripe_sdk" } });
    else pi.amount_received = pi.amount;
    const { scenario, ...intent } = pi;
    return send(res, 200, intent);
  }
  // For the tests: a bank payment clears or fails, as Stripe reports it days later. Answers the payment as it now stands.
  const settle = p.match(/^\/stripe\/__settle\/(pi_[A-Za-z0-9_]+)$/);
  if (settle) {
    const pi = intents.get(settle[1]);
    if (!pi) return send(res, 404, { message: "no such payment" });
    if (body.outcome === "fail") Object.assign(pi, { status: "requires_payment_method", last_payment_error: { type: "invalid_request_error", code: "insufficient_funds", message: "The customer's account has insufficient funds to cover this payment." } });
    else Object.assign(pi, { status: "succeeded", amount_received: pi.amount });
    const { scenario, ...intent } = pi;
    return send(res, 200, intent);
  }
  return stripeError(res, 404, { type: "invalid_request_error", message: "not mocked: " + p });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let raw = ""; for await (const c of req) raw += c;
  const form = (req.headers["content-type"] || "").includes("application/x-www-form-urlencoded");
  const body = !raw ? {} : form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  const email = tokens.get(bearer);
  const p = url.pathname;
  console.log(req.method, p + url.search, email ?? "-");
  // Which SKUs have a cost: SKUs only, and only for the server key.
  if (p === "/rest/v1/rpc/priced_skus") {
    if (req.headers.apikey !== SECRET) return send(res, 401, { message: "Invalid API key" });
    if (outage) return send(res, 503, { message: "down for the test" });
    return send(res, 200, Object.keys(COSTS).sort());
  }
  // Stripe: the site's server calls /stripe/v1/... (STRIPE_API_URL), the fake Stripe.js in the browser /stripe/js/...
  if (p.startsWith("/stripe/")) return stripe(req, res, p, body);
  // The pay page's two server-key functions, with the same rules as the migration.
  if (p === "/rest/v1/rpc/order_for_pay") {
    if (req.headers.apikey !== SECRET) return send(res, 401, { message: "Invalid API key" });
    const o = orders.find((x) => x.pay_token === body.p_token);
    if (!o) return send(res, 200, []);
    const a = Object.values(ACCOUNTS).find((x) => x.id === o.account_id);
    return send(res, 200, [{
      order_id: o.id, order_number: o.number, account_name: a.name, created_at: o.created_at, status: o.status, subtotal: o.subtotal,
      delivery_fee: o.delivery_fee, next_day: o.next_day, next_day_fee: o.next_day_fee, amount_due: o.delivery_fee == null ? o.subtotal : o.total,
      site_locale: o.site_locale, lines: [...o.order_lines].sort((x, y) => x.sku.localeCompare(y.sku)).map((l) => ({ sku: l.sku, cases: l.cases, price: l.price_per_case })),
      payment_status: o.payment_status, payment_method: o.payment_method, card_fee: o.card_fee, payment_amount: o.payment_amount, paid_at: o.paid_at, payment_updated_at: o.payment_updated_at,
    }]);
  }
  if (p === "/rest/v1/rpc/set_order_payment") {
    if (req.headers.apikey !== SECRET) return send(res, 401, { message: "Invalid API key" });
    if (failPayments > 0) { failPayments--; return send(res, 500, { code: "XX000", message: "failed for the test" }); }
    const { p_order, p_status, p_intent, p_method, p_card_fee, p_amount } = body;
    if (!["processing", "paid", "failed"].includes(p_status) || !/^pi_[A-Za-z0-9_]+$/.test(p_intent ?? "")) return send(res, 400, { code: "22023", message: "bad payment" });
    if (p_status !== "failed" && (!["bank", "credit_card", "debit_card", "card"].includes(p_method) || !(p_amount > 0) || (p_card_fee ?? 0) < 0)) return send(res, 400, { code: "22023", message: "bad payment" });
    const o = orders.find((x) => x.id === p_order);
    if (!o) return send(res, 200, []);
    const was = o.payment_status, intent = o.stripe_payment_intent;
    let result;
    const now = new Date().toISOString();
    if (p_status === "failed") {
      if (intent !== p_intent || was === "paid") result = "ignored";
      else if (was === "failed") result = "same";
      else { Object.assign(o, { payment_status: "failed", payment_updated_at: now }); result = "changed"; }
    } else if (intent === p_intent && (was === p_status || (was === "paid" && p_status === "processing"))) result = "same";
    else if (was === "paid" || (was === "processing" && p_status === "processing")) result = "twice";
    else {
      Object.assign(o, { payment_status: p_status, stripe_payment_intent: p_intent, payment_method: p_method, card_fee: Math.round((p_card_fee ?? 0) * 100) / 100, payment_amount: p_amount, paid_at: p_status === "paid" ? now : null, payment_updated_at: now });
      result = was === "processing" && intent !== p_intent ? "twice" : "changed";
    }
    const a = Object.values(ACCOUNTS).find((x) => x.id === o.account_id);
    return send(res, 200, [{ result, order_number: o.number, account_name: a.name, pay_token: o.pay_token, site_locale: o.site_locale, order_status: o.status }]);
  }
  if (p === "/__test/stripe") return send(res, 200, { intents: stripeCalls, tokens: [...ctokens.values()] });
  if (p === "/__test/fail-payments" && req.method === "POST") {
    failPayments = Number(body.times) || 1;
    return send(res, 200, { failPayments });
  }
  // For the tests only: load or remove costs as the dashboard would, or take priced_skus down.
  if (p === "/__test/costs" && req.method === "POST") {
    for (const [sku, cost] of Object.entries(body)) {
      if (cost == null) delete COSTS[sku];
      else COSTS[sku] = cost;
    }
    return send(res, 200, Object.keys(COSTS).sort());
  }
  if (p === "/__test/weekly" && req.method === "POST") {
    if (typeof body.live === "boolean") weeklyLive = body.live;
    if (body.fail) failWeekly = Number(body.fail) || 1;
    return send(res, 200, { weeklyLive, failWeekly });
  }
  if (p === "/__test/fail-details" && req.method === "POST") {
    failDetails = Number(body.times) || 1;
    return send(res, 200, { failDetails });
  }
  // An order placed for Kebab House without the browser, priced like place_order: the pay tests make many.
  if (p === "/__test/order" && req.method === "POST") {
    const a = ACCOUNTS[body.account ?? "A"];
    const lines = (body.lines ?? [{ sku: "CUP-PET-16", cases: 2 }]).map((l) => ({ sku: l.sku, cases: l.cases, price_per_case: COSTS[l.sku] == null ? null : price(COSTS[l.sku]) }));
    const subtotal = lines.some((l) => l.price_per_case == null) ? null : Math.round(lines.reduce((t, l) => t + l.price_per_case * l.cases * 100, 0)) / 100;
    const total = subtotal == null ? null : Math.round((subtotal + PRICING.delivery_fee) * 100) / 100;
    const o = {
      id: crypto.randomUUID(), number: next++, account_id: a.id, created_at: new Date().toISOString(), status: body.status ?? "received", note: null,
      subtotal, next_day: false, delivery_fee: PRICING.delivery_fee, next_day_fee: 0, total, order_lines: lines,
      site_locale: body.locale ?? "en", pay_token: crypto.randomUUID(), payment_status: "unpaid", payment_method: null, card_fee: null,
      payment_amount: null, paid_at: null, payment_updated_at: null, stripe_payment_intent: null,
    };
    orders.push(o);
    return send(res, 200, { id: o.id, number: o.number, pay_token: o.pay_token, total: o.total });
  }
  // The team corrects what an order comes to in the dashboard (a short delivery, say).
  if (p === "/__test/order-amount" && req.method === "POST") {
    const o = orders.find((x) => String(x.number) === String(body.number));
    if (!o) return send(res, 404, { message: "no such order" });
    Object.assign(o, { subtotal: body.subtotal, total: body.total });
    return send(res, 200, { number: o.number, total: o.total });
  }
  if (p === "/__test/order") {
    const o = orders.find((x) => String(x.number) === url.searchParams.get("number"));
    return o ? send(res, 200, o) : send(res, 404, { message: "no such order" });
  }
  // The team moves an order along in the dashboard.
  if (p === "/__test/order-status" && req.method === "POST") {
    const o = orders.find((x) => String(x.number) === String(body.number));
    if (!o) return send(res, 404, { message: "no such order" });
    o.status = body.status;
    return send(res, 200, { number: o.number, status: o.status });
  }
  if (p === "/__test/fail-account" && req.method === "POST") {
    failAccounts = Number(body.times) || 1;
    return send(res, 200, { failAccounts });
  }
  // Sets the margin or the fees, as the dashboard would. Send only the keys to change; it answers with all three.
  if (p === "/__test/pricing" && req.method === "POST") {
    for (const k of ["margin", "delivery_fee", "next_day_fee"]) if (typeof body[k] === "number") PRICING[k] = body[k];
    return send(res, 200, PRICING);
  }
  if (p === "/__test/outage" && req.method === "POST") {
    outage = body.on === true;
    return send(res, 200, { outage });
  }
  // The site sends its emails here when RESEND_API_URL points at this mock.
  if (p === "/resend/emails" && req.method === "POST") {
    if (bearer !== "re_test") return send(res, 401, { message: "API key is invalid" });
    emails.push({ from: body.from, to: body.to, subject: body.subject, text: body.text ?? null, html: body.html ?? null, reply_to: body.reply_to ?? null });
    return send(res, 200, { id: crypto.randomUUID() });
  }
  if (p === "/__test/emails") return send(res, 200, emails);
  if (p === "/auth/v1/otp") {
    // Open sign-up: an unknown email gets a login.
    if (!USERS[body.email]) {
      if (body.create_user === false) return send(res, 422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" });
      USERS[body.email] = { id: crypto.randomUUID(), accounts: [] };
    }
    return send(res, 200, {});
  }
  if (p === "/auth/v1/verify") {
    if (body.token !== "123456" || !USERS[body.email]) return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    return send(res, 200, session(body.email));
  }
  // Password sign-in. Nobody has a password until they set one; a wrong password and an unknown email look the same.
  if (p === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
    const u = USERS[body.email];
    if (!u?.password || u.password !== body.password) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    return send(res, 200, session(body.email));
  }
  if (p === "/auth/v1/token") {
    const em = String(body.refresh_token || "").replace(/^refresh-/, "");
    return USERS[em] ? send(res, 200, session(em)) : send(res, 400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
  }
  // Setting a password (and the has_password note). "pwned-password" stands in for one Supabase refuses.
  if (p === "/auth/v1/user" && req.method === "PUT") {
    if (!email) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    if (body.password != null) {
      if (body.password === "pwned-password" || String(body.password).length < 6) return send(res, 422, { code: 422, error_code: "weak_password", msg: "Password is too weak" });
      if (USERS[email].password === body.password) return send(res, 422, { code: 422, error_code: "same_password", msg: "New password should be different from the old password." });
      USERS[email].password = body.password;
    }
    if (body.data) USERS[email].meta = { ...(USERS[email].meta ?? {}), ...body.data };
    return send(res, 200, user(email));
  }
  if (p === "/auth/v1/user") return email ? send(res, 200, user(email)) : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  if (p === "/auth/v1/logout") { tokens.delete(bearer); return send(res, 204); }
  if (!email) return send(res, 401, { message: "JWT expired" });
  const eq = (k) => (url.searchParams.get(k) || "").replace(/^eq\./, "");
  // Only the columns the migrations grant to signed-in customers, and only the ones asked for.
  if (p === "/rest/v1/accounts") {
    const granted = ["id", "name", "delivery_day", "created_at", "contact_name", "phone", "street", "city", "zip", "preferred_language"];
    const asked = (url.searchParams.get("select") || "").split(",").map((c) => c.trim()).filter(Boolean);
    const refused = asked.find((c) => !granted.includes(c));
    if (refused) return send(res, 403, { code: "42501", message: `permission denied for column ${refused}` });
    let rows = mine(email);
    if (url.searchParams.get("id")) rows = rows.filter((a) => a.id === eq("id"));
    return single(req, res, rows.map((a) => Object.fromEntries((asked.length ? asked : granted).map((c) => [c, a[c] ?? null]))));
  }
  if (p === "/rest/v1/account_users") {
    let rows = USERS[email].accounts.map((k) => ({ account_id: ACCOUNTS[k].id, user_id: USERS[email].id, role: USERS[email].roles?.[k] ?? "owner" }));
    if (url.searchParams.get("account_id")) rows = rows.filter((r) => r.account_id === eq("account_id"));
    return single(req, res, rows);
  }
  // The owner of an active business corrects its details. The table's checks hold the formats.
  if (p === "/rest/v1/rpc/update_my_account") {
    const key = USERS[email].accounts.find((k) => ACCOUNTS[k].id === body.p_account);
    if (!key || !ACCOUNTS[key].active || (USERS[email].roles?.[key] ?? "owner") !== "owner") return send(res, 403, { code: "42501", message: "only the owner of an active account can change its details" });
    if (failDetails > 0) { failDetails--; return send(res, 500, { code: "XX000", message: "failed for the test" }); }
    if (![body.p_name, body.p_contact_name, body.p_street, body.p_city].every((v) => typeof v === "string" && v.trim())) return send(res, 400, { code: "22023", message: "business name, contact name, phone and address are required" });
    if (!/^\+1[2-9][0-9]{9}$/.test(body.p_phone ?? "") || !/^[0-9]{5}$/.test(body.p_zip ?? "")) return send(res, 400, { code: "23514", message: "violates check constraint" });
    Object.assign(ACCOUNTS[key], { name: body.p_name.trim(), contact_name: body.p_contact_name.trim(), phone: body.p_phone, street: body.p_street.trim(), city: body.p_city.trim(), zip: body.p_zip, preferred_language: ["en", "es", "tr", "ar"].includes(body.p_language) ? body.p_language : ACCOUNTS[key].preferred_language });
    return send(res, 204);
  }
  // A member cancels an order that is still received.
  if (p === "/rest/v1/rpc/cancel_my_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member of this account" });
    const o = orders.find((x) => x.account_id === a.id && String(x.number) === String(body.p_number));
    if (!o) return send(res, 200, "not_found");
    const paying = o.payment_status === "paid" || o.payment_status === "processing";
    if (o.status === "received" && !paying) { o.status = "canceled"; o.canceled_at = new Date().toISOString(); return send(res, 200, "canceled"); }
    return send(res, 200, o.status === "canceled" ? "canceled" : paying ? "paid" : "too_late");
  }
  if (p === "/rest/v1/rpc/my_prices") {
    if (!mine(email).some((x) => x.id === body.p_account)) return send(res, 200, []);
    return send(res, 200, Object.entries(COSTS).map(([sku, c]) => ({ sku, price_per_case: price(c) })));
  }
  if (p === "/rest/v1/rpc/order_fees") return send(res, 200, [{ delivery_fee: PRICING.delivery_fee, next_day_fee: PRICING.next_day_fee }]);
  if (p === "/rest/v1/rpc/create_my_account") {
    if (failAccounts > 0) {
      failAccounts--;
      return send(res, 500, { code: "XX000", message: "failed for the test" });
    }
    if (USERS[email].accounts.length) return send(res, 409, { code: "23505", message: "already has an account" });
    const key = "N" + Object.keys(ACCOUNTS).length;
    ACCOUNTS[key] = { id: crypto.randomUUID(), name: body.p_name, delivery_day: null, created_at: new Date().toISOString(), active: true, details: body, contact_name: body.p_contact_name, phone: body.p_phone, street: body.p_street, city: body.p_city, zip: body.p_zip, preferred_language: body.p_language ?? "en" };
    USERS[email].accounts.push(key);
    return send(res, 200, ACCOUNTS[key].id);
  }
  if (p === "/rest/v1/usual_orders") {
    const u = usual[eq("account_id")];
    return single(req, res, u && mine(email).some((a) => a.id === eq("account_id")) ? [u] : []);
  }
  if (p === "/rest/v1/orders") {
    let rows = orders.filter((o) => mine(email).some((a) => a.id === o.account_id));
    if (url.searchParams.get("account_id")) rows = rows.filter((o) => o.account_id === eq("account_id"));
    if (url.searchParams.get("id")) rows = rows.filter((o) => o.id === eq("id"));
    if (url.searchParams.get("number")) rows = rows.filter((o) => String(o.number) === eq("number"));
    rows = [...rows].sort((a, b) => b.number - a.number).slice(0, Number(url.searchParams.get("limit") || 1000));
    return single(req, res, rows.map(({ account_id, stripe_payment_intent, site_locale, ...o }) => o));
  }
  if (p === "/rest/v1/rpc/place_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member of this account" });
    const nextDay = body.p_next_day === true;
    const lines = body.p_lines.map((l) => ({ sku: l.sku, cases: l.cases, price_per_case: COSTS[l.sku] == null ? null : price(COSTS[l.sku]) }));
    const subtotal = lines.some((l) => l.price_per_case == null) ? null : Math.round(lines.reduce((s, l) => s + l.price_per_case * l.cases * 100, 0)) / 100;
    const nextDayFee = nextDay ? PRICING.next_day_fee : 0;
    const total = subtotal == null ? null : Math.round((subtotal + PRICING.delivery_fee + nextDayFee) * 100) / 100;
    const o = {
      id: crypto.randomUUID(), number: next++, account_id: a.id, created_at: new Date().toISOString(), status: "received", note: body.p_note,
      subtotal, next_day: nextDay, delivery_fee: PRICING.delivery_fee, next_day_fee: nextDayFee, total, order_lines: lines,
      site_locale: ["en", "es", "tr", "ar"].includes(body.p_locale) ? body.p_locale : "en",
      pay_token: crypto.randomUUID(), payment_status: "unpaid", payment_method: null, card_fee: null, payment_amount: null, paid_at: null,
      payment_updated_at: null, stripe_payment_intent: null,
    };
    orders.push(o);
    return send(res, 200, [{ order_id: o.id, order_number: o.number, order_subtotal: subtotal, order_total: total }]);
  }
  if (p === "/rest/v1/rpc/save_usual_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member" });
    // Saving new lines keeps the weekly choice, like the real upsert.
    usual[a.id] = { weekly: false, skip_date: null, ...(usual[a.id] ?? {}), lines: body.p_lines, updated_at: new Date().toISOString() };
    return send(res, 200, body.p_lines.length);
  }
  // The weekly order: the switch for the site, the calendar, asking for it and skipping.
  if (p === "/rest/v1/rpc/weekly_orders_live") return send(res, 200, weeklyLive);
  if (p === "/rest/v1/rpc/next_delivery") return send(res, 200, nextDelivery(body.p_day));
  if (p === "/rest/v1/rpc/set_weekly_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member of this account" });
    if (failWeekly > 0) { failWeekly--; return send(res, 500, { code: "XX000", message: "failed for the test" }); }
    const u = usual[a.id];
    if (body.p_on) {
      if (!u?.lines?.length) return send(res, 400, { code: "22023", message: "save a usual order first" });
      u.weekly = true;
    } else if (u) {
      u.weekly = false; u.skip_date = null;
    }
    return send(res, 204);
  }
  if (p === "/rest/v1/rpc/skip_weekly_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member of this account" });
    const next = nextDelivery(a.delivery_day)[0];
    if (!next) return send(res, 400, { code: "22023", message: "this account has no delivery day yet" });
    if (!usual[a.id]?.weekly) return send(res, 400, { code: "22023", message: "the weekly order is off" });
    usual[a.id].skip_date = body.p_skip ? next.delivery_date : null;
    return send(res, 200, next.delivery_date);
  }
  send(res, 404, { message: "not mocked: " + p });
}).listen(54321, "127.0.0.1", () => console.log("mock supabase on 54321"));
