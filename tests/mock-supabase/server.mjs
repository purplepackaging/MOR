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
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let raw = ""; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
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
    if (o.status === "received") { o.status = "canceled"; o.canceled_at = new Date().toISOString(); return send(res, 200, "canceled"); }
    return send(res, 200, o.status === "canceled" ? "canceled" : "too_late");
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
    return single(req, res, rows.map(({ account_id, ...o }) => o));
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
