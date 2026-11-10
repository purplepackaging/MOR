// A tiny stand-in for Supabase Auth + PostgREST, enough to drive the portal UI end to end.
import http from "node:http";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USERS = {
  "owner@kebab.test": { id: "11111111-1111-1111-1111-111111111111", accounts: ["A"] },
  "taco@spot.test": { id: "22222222-2222-2222-2222-222222222222", accounts: ["B"] },
  "new@user.test": { id: "33333333-3333-3333-3333-333333333333", accounts: [] },
};
const ACCOUNTS = {
  A: { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Kebab House", delivery_day: "thu", created_at: "2026-11-01T12:00:00Z", markup: 0.3 },
  B: { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Taco Spot", delivery_day: null, created_at: "2026-11-02T12:00:00Z", markup: null },
};
const COSTS = { "CUP-PET-16": 40, "LID-DOME-98H": 30, "HBG-96N": 33.33, "POR-020C": 25 };
const orders = []; const usual = {}; let next = 1001;
const tokens = new Map(); // access token -> email
const user = (email) => ({ id: USERS[email].id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: "2026-11-01T00:00:00Z", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" });
function session(email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USERS[email].id, email, exp, aud: "authenticated", role: "authenticated" })}.sig${Math.random().toString(36).slice(2)}`;
  tokens.set(access, email);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "refresh-" + email, user: user(email) };
}
const accountById = (id) => Object.values(ACCOUNTS).find((a) => a.id === id);
const mine = (email) => (USERS[email]?.accounts ?? []).map((k) => ACCOUNTS[k]);
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let raw = ""; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
  const email = tokens.get(bearer);
  const p = url.pathname;
  console.log(req.method, p + url.search, email ?? "-");
  if (p === "/auth/v1/otp") {
    if (!USERS[body.email]) return send(res, 422, { code: 422, error_code: "otp_disabled", msg: "Signups not allowed for otp" });
    return send(res, 200, {});
  }
  if (p === "/auth/v1/verify") {
    if (body.token !== "123456" || !USERS[body.email]) return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
    return send(res, 200, session(body.email));
  }
  if (p === "/auth/v1/token") {
    const em = String(body.refresh_token || "").replace(/^refresh-/, "");
    return USERS[em] ? send(res, 200, session(em)) : send(res, 400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
  }
  if (p === "/auth/v1/user") return email ? send(res, 200, user(email)) : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
  if (p === "/auth/v1/logout") { tokens.delete(bearer); return send(res, 204); }
  if (!email) return send(res, 401, { message: "JWT expired" });
  const eq = (k) => (url.searchParams.get(k) || "").replace(/^eq\./, "");
  if (p === "/rest/v1/accounts") return send(res, 200, mine(email).map(({ id, name, delivery_day, created_at }) => ({ id, name, delivery_day, created_at })));
  if (p === "/rest/v1/rpc/my_prices") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a || a.markup == null) return send(res, 200, []);
    return send(res, 200, Object.entries(COSTS).map(([sku, c]) => ({ sku, price_per_case: Math.round(c * (1 + a.markup) * 100) / 100 })));
  }
  if (p === "/rest/v1/usual_orders") {
    const u = usual[eq("account_id")];
    const rows = u && mine(email).some((a) => a.id === eq("account_id")) ? [u] : [];
    if ((req.headers.accept || "").includes("vnd.pgrst.object")) return rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "0 rows" });
    return send(res, 200, rows);
  }
  if (p === "/rest/v1/orders") {
    let rows = orders.filter((o) => o.account_id === eq("account_id") && mine(email).some((a) => a.id === o.account_id));
    if (url.searchParams.get("number")) rows = rows.filter((o) => String(o.number) === eq("number"));
    rows = [...rows].sort((a, b) => b.number - a.number).slice(0, Number(url.searchParams.get("limit") || 1000));
    const out = rows.map(({ account_id, ...o }) => o);
    if ((req.headers.accept || "").includes("vnd.pgrst.object")) return out.length ? send(res, 200, out[0]) : send(res, 406, { code: "PGRST116", message: "0 rows" });
    return send(res, 200, out);
  }
  if (p === "/rest/v1/rpc/place_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member of this account" });
    const lines = body.p_lines.map((l) => ({ sku: l.sku, cases: l.cases, price_per_case: a.markup == null || COSTS[l.sku] == null ? null : Math.round(COSTS[l.sku] * (1 + a.markup) * 100) / 100 }));
    const subtotal = lines.some((l) => l.price_per_case == null) ? null : Math.round(lines.reduce((s, l) => s + l.price_per_case * l.cases, 0) * 100) / 100;
    const o = { id: crypto.randomUUID(), number: next++, account_id: a.id, created_at: new Date().toISOString(), status: "received", note: body.p_note, subtotal, order_lines: lines };
    orders.push(o);
    return send(res, 200, [{ order_id: o.id, order_number: o.number, order_subtotal: subtotal }]);
  }
  if (p === "/rest/v1/rpc/save_usual_order") {
    const a = mine(email).find((x) => x.id === body.p_account);
    if (!a) return send(res, 403, { code: "42501", message: "not a member" });
    usual[a.id] = { lines: body.p_lines, updated_at: new Date().toISOString() };
    return send(res, 200, body.p_lines.length);
  }
  send(res, 404, { message: "not mocked: " + p });
}).listen(54321, "127.0.0.1", () => console.log("mock supabase on 54321"));
