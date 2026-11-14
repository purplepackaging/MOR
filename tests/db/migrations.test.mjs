import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2] ?? new URL("../../supabase/migrations", import.meta.url).pathname;
const db = new PGlite();
const ok = (m) => console.log("PASS", m);
const bad = (m) => { console.log("FAIL", m); process.exitCode = 1; };
async function expectError(sql, params, code, label) {
  try { await db.query(sql, params); bad(`${label}: no error`); }
  catch (e) { (e.code === code ? ok : bad)(`${label} -> ${e.code} ${e.message}`); }
}
const run = (f) => db.exec(readFileSync(`${dir}/${f}`, "utf8"));
const SELF_SERVICE = readdirSync(dir).find((f) => f.endsWith("_self_service.sql"));
const WEEKLY = readdirSync(dir).find((f) => f.endsWith("_weekly_order.sql"));
const MARGIN_30 = readdirSync(dir).find((f) => f.endsWith("_margin_30.sql"));
const NO_FEES = readdirSync(dir).find((f) => f.endsWith("_no_delivery_fees.sql"));
const PAYMENTS = readdirSync(dir).find((f) => f.endsWith("_payments.sql"));
// Supabase stand-ins
async function supabaseStandIns(d) {
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  // Supabase grants broad default privileges in public; mimic that so the migration's revokes are tested.
  await d.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
                alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
}
await supabaseStandIns(db);
for (const f of ["20261109000000_init.sql", "20261110000000_portal.sql", "20261110155000_api_grants.sql"]) await run(f);
ok("first migrations ran");
await run("20261110000000_portal.sql");
ok("portal migration is re-runnable");

const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222", U3 = "33333333-3333-3333-3333-333333333333";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
// An account set up under the old tiers, to prove the next migration keeps it.
await db.exec(`
  insert into auth.users values ('${U1}','a@x.com'),('${U2}','b@x.com'),('${U3}','c@x.com');
  insert into public.accounts (id, name, tier, delivery_day) values ('${A}','Kebab House','M','thu'),('${B}','Taco Spot',null,null);
  insert into public.account_users (account_id, user_id, role) values ('${A}','${U1}','owner'),('${B}','${U2}','owner');
  insert into public.product_costs (sku, cost_per_case) values ('CUP-PET-16', 40.00), ('HBG-96N', 33.33);
`);
await run("20261110190000_open_signup_pricing.sql");
ok("open sign-up migration ran over existing data");
await run("20261110190000_open_signup_pricing.sql");
ok("open sign-up migration is re-runnable");
await run("20261111150518_priced_skus.sql");
await run("20261111150518_priced_skus.sql");
ok("priced SKUs migration ran, twice");
await run(SELF_SERVICE);
await run(SELF_SERVICE);
ok("self-service migration ran, twice");
await run(WEEKLY);
await run(WEEKLY);
ok("weekly order migration ran, twice");
await run(MARGIN_30);
await run(MARGIN_30);
ok("30% margin migration ran, twice");
await run(NO_FEES);
await run(NO_FEES);
ok("no-fees migration ran, twice");
await run(PAYMENTS);
await run(PAYMENTS);
ok("payments migration ran, twice");

let r = await db.query(`select to_regclass('public.price_tiers') t, (select count(*)::int from information_schema.columns where table_name = 'accounts' and column_name = 'tier') c`);
(r.rows[0].t === null && r.rows[0].c === 0 ? ok : bad)("tiers are gone");
r = await db.query(`select margin::text m, delivery_fee::text d, next_day_fee::text n, (select count(*)::int from public.pricing) rows from public.pricing`);
(r.rows[0].m === "0.3000" && r.rows[0].d === "0.00" && r.rows[0].n === "0.00" && r.rows[0].rows === 1 ? ok : bad)(`one pricing row, at a 30% margin with no delivery or next-day fee: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select round(10 / (1 - margin), 2)::text p from public.pricing`);
(r.rows[0].p === "14.29" ? ok : bad)(`a $10.00 case sells for ${r.rows[0].p} at 30% (it was 13.33 at 25%)`);
// The checks below keep the launch values (25%, $50 delivery, $50 next-day), so their arithmetic stays as written.
await db.exec(`update public.pricing set margin = 0.25, delivery_fee = 50, next_day_fee = 50`);
await expectError(`insert into public.pricing (id) values (false)`, [], "23514", "pricing stays a single row");
r = await db.query(`select count(*)::int n from public.accounts`);
(r.rows[0].n === 2 ? ok : bad)("existing accounts kept");

const as = async (uid) => { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false);`); };

await as(U1);
r = await db.query(`select id, name, delivery_day from public.accounts`);
(r.rows.length === 1 && r.rows[0].name === "Kebab House" ? ok : bad)(`u1 sees only own account (${r.rows.length})`);
await expectError(`select notes from public.accounts`, [], "42501", "u1 cannot read account notes");
await expectError(`select * from public.product_costs`, [], "42501", "u1 cannot read costs");
await expectError(`select * from public.pricing`, [], "42501", "u1 cannot read the margin");
r = await db.query(`select * from public.my_prices($1) order by sku`, [A]);
const p = Object.fromEntries(r.rows.map((x) => [x.sku, Number(x.price_per_case)]));
(p["CUP-PET-16"] === 53.33 && p["HBG-96N"] === 44.44 ? ok : bad)(`25% margin prices: ${JSON.stringify(p)} (40 / 0.75 = 53.33, 33.33 / 0.75 = 44.44)`);
r = await db.query(`select * from public.my_prices($1)`, [B]);
(r.rows.length === 0 ? ok : bad)("u1 gets no prices for someone else's account");
r = await db.query(`select delivery_fee::text d, next_day_fee::text n from public.order_fees()`);
(r.rows.length === 1 && r.rows[0].d === "50.00" && r.rows[0].n === "50.00" ? ok : bad)(`customers see the fees: ${JSON.stringify(r.rows)}`);

const lines = JSON.stringify([
  { sku: "CUP-PET-16", cases: 4 }, { sku: "CUP-PET-16", cases: 9 }, { sku: "HBG-96N", cases: 2 },
  { sku: "NOCOST-1", cases: 1 }, { sku: "bad sku", cases: 1 }, { sku: "LID-X", cases: 2.5 }, { sku: "LID-Y", cases: 0 }, { sku: "LID-Z", cases: 1000 }, "junk",
]);
r = await db.query(`select * from public.place_order($1, $2::jsonb, $3, $4)`, [A, lines, "  Back door please  ", "tr"]);
const o1 = r.rows[0];
(o1.order_number === 1001n || Number(o1.order_number) === 1001 ? ok : bad)(`first order number ${o1.order_number}`);
(o1.order_subtotal === null && o1.order_total === null ? ok : bad)("subtotal and total are empty when a line has no cost");
r = await db.query(`select sku, cases, price_per_case from public.order_lines where order_id = $1 order by sku`, [o1.order_id]);
(JSON.stringify(r.rows.map((x) => [x.sku, x.cases, x.price_per_case === null ? null : Number(x.price_per_case)])) ===
  JSON.stringify([["CUP-PET-16", 4, 53.33], ["HBG-96N", 2, 44.44], ["NOCOST-1", 1, null]]) ? ok : bad)(`lines cleaned: ${JSON.stringify(r.rows)}`);
r = await db.query(`select note, site_locale from public.orders where id = $1`, [o1.order_id]).catch((e) => ({ rows: [{ err: e.code }] }));
(r.rows[0].err === "42501" ? ok : bad)("site_locale column is not readable by customers");
r = await db.query(`select note, status, next_day, delivery_fee::text d, next_day_fee::text n from public.orders where id = $1`, [o1.order_id]);
(r.rows[0].note === "Back door please" && r.rows[0].status === "received" && r.rows[0].next_day === false && r.rows[0].d === "50.00" && r.rows[0].n === "0.00" ? ok : bad)(`note trimmed, status received, delivery fee copied: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select * from public.place_order($1, $2::jsonb, null, 'en', true)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 3 }, { sku: "HBG-96N", cases: 1 }])]);
(Number(r.rows[0].order_subtotal) === 204.43 && Number(r.rows[0].order_total) === 304.43 ? ok : bad)(`next-day order: subtotal ${r.rows[0].order_subtotal}, total ${r.rows[0].order_total} (3 x 53.33 + 44.44 = 204.43, + 50 + 50 = 304.43)`);
r = await db.query(`select next_day, next_day_fee::text n, total::text t from public.orders where id = $1`, [r.rows[0].order_id]);
(r.rows[0].next_day === true && r.rows[0].n === "50.00" && r.rows[0].t === "304.43" ? ok : bad)(`next-day fee and total saved: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "HBG-96N", cases: 1 }])]);
(Number(r.rows[0].order_total) === 94.44 ? ok : bad)(`standard delivery by default: total ${r.rows[0].order_total} (44.44 + 50)`);
await expectError(`select * from public.place_order($1, $2::jsonb)`, [B, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])], "42501", "u1 cannot order for another account");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, "[]"], "22023", "empty order rejected");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "x", cases: 1 }])], "22023", "order with no valid lines rejected");
await expectError(`insert into public.orders (account_id) values ($1)`, [A], "42501", "no direct inserts into orders");
await expectError(`update public.orders set status = 'delivered'`, [], "42501", "customers cannot change status");
await expectError(`update public.pricing set margin = 0`, [], "42501", "customers cannot change pricing");
r = await db.query(`select * from public.save_usual_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "HBG-96N", cases: 3 }, { sku: "CUP-PET-16", cases: 2 }, { sku: "HBG-96N", cases: 7 }])]);
(r.rows[0].save_usual_order === 2 ? ok : bad)(`usual order saved with ${r.rows[0].save_usual_order} lines`);
r = await db.query(`select lines from public.usual_orders`);
(JSON.stringify(r.rows[0].lines) === JSON.stringify([{ sku: "HBG-96N", cases: 3 }, { sku: "CUP-PET-16", cases: 2 }]) ? ok : bad)(`usual order keeps list order: ${JSON.stringify(r.rows[0].lines)}`);
await expectError(`select * from public.save_usual_order($1, $2::jsonb)`, [B, "[]"], "42501", "u1 cannot save another account's usual order");
r = await db.query(`select count(*)::int n from public.orders`); (r.rows[0].n === 3 ? ok : bad)(`u1 sees own 3 orders`);
await expectError(`select public.create_my_account('Second', 'Ann', '+14045550123', '1 Main St', 'Atlanta', '30303')`, [], "23505", "people already on an account cannot create another");

await as(U2);
r = await db.query(`select * from public.place_order($1, $2::jsonb)`, [B, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])]);
(Number(r.rows[0].order_subtotal) === 53.33 ? ok : bad)("every account gets prices now");
r = await db.query(`select count(*)::int n from public.orders`); (r.rows[0].n === 1 ? ok : bad)(`u2 sees only own order (${r.rows[0].n})`);
r = await db.query(`select count(*)::int n from public.order_lines`); (r.rows[0].n === 1 ? ok : bad)(`u2 sees only own lines (${r.rows[0].n})`);
r = await db.query(`select count(*)::int n from public.usual_orders`); (r.rows[0].n === 0 ? ok : bad)("u2 cannot see u1's usual order");

// Open sign-up: a signed-in person with no account sets one up.
await as(U3);
r = await db.query(`select count(*)::int n from public.accounts`); (r.rows[0].n === 0 ? ok : bad)("user with no account sees nothing");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])], "42501", "unlinked user cannot order");
await expectError(`select public.create_my_account('Pho Place', 'Linh', '404-555-0123', '1 Main St', 'Atlanta', '30303')`, [], "23514", "phone must be +1 and 10 digits");
await expectError(`select public.create_my_account('Pho Place', 'Linh', '+14045550123', '1 Main St', 'Atlanta', '3030')`, [], "23514", "ZIP must be 5 digits");
await expectError(`select public.create_my_account('  ', 'Linh', '+14045550123', '1 Main St', 'Atlanta', '30303')`, [], "22023", "business name is required");
await expectError(`select public.create_my_account('Pho Place', 'Linh', '+14045550123', '', 'Atlanta', '30303')`, [], "22023", "street is required");
await expectError(`select public.create_my_account('Pho Place', 'Linh', '+14045550123', '1 Main St', 'Atlanta', '30303', 'en', 'spaceship')`, [], "23514", "unknown business types are rejected");
r = await db.query(`select public.create_my_account(' Pho Place ', ' Linh ', '+14045550123', '1 Main St', 'Atlanta', '30303', 'xx', 'restaurant', ' ali-7 ', 'I agree to texts.') id`);
const C = r.rows[0].id;
(typeof C === "string" && C.length === 36 ? ok : bad)("create_my_account returns the new account id");
r = await db.query(`select id, name from public.accounts`);
(r.rows.length === 1 && r.rows[0].id === C && r.rows[0].name === "Pho Place" ? ok : bad)(`the new owner can read their account: ${JSON.stringify(r.rows)}`);
r = await db.query(`select role from public.account_users where user_id = $1`, [U3]);
(r.rows.length === 1 && r.rows[0].role === "owner" ? ok : bad)("creator is the owner");
r = await db.query(`select * from public.my_prices($1) order by sku`, [C]);
(r.rows.length === 2 ? ok : bad)("a new account sees prices right away");
r = await db.query(`select * from public.place_order($1, $2::jsonb, 'First order', 'es', true)`, [C, JSON.stringify([{ sku: "CUP-PET-16", cases: 2 }])]);
(Number(r.rows[0].order_total) === 206.66 ? ok : bad)(`a new account can order right away: total ${r.rows[0].order_total} (2 x 53.33 + 50 + 50)`);
await expectError(`select public.create_my_account('Pho Place 2', 'Linh', '+14045550123', '1 Main St', 'Atlanta', '30303')`, [], "23505", "one business per sign-up");
await db.exec(`reset role;`);
r = await db.query(`select contact_name, phone, email, street, zip, preferred_language, business_type, rep_code, sms_consent, sms_consent_text, sms_consent_at is not null consent_time, created_by from public.accounts where id = $1`, [C]);
const c = r.rows[0];
(c.contact_name === "Linh" && c.phone === "+14045550123" && c.email === "c@x.com" && c.zip === "30303" && c.preferred_language === "en" &&
  c.business_type === "restaurant" && c.rep_code === "ALI7" && c.sms_consent === true && c.sms_consent_text === "I agree to texts." && c.consent_time && c.created_by === U3 ? ok : bad)(`new account details saved: ${JSON.stringify(c)}`);
await db.exec(`insert into auth.users values ('55555555-5555-5555-5555-555555555555', 'e@x.com');`);
await as("55555555-5555-5555-5555-555555555555");
r = await db.query(`select public.create_my_account('Taqueria', 'Rosa', '+16785550199', '9 Peach St', 'Decatur', '30030') id`);
await db.exec(`reset role;`);
r = await db.query(`select sms_consent, sms_consent_text, rep_code, business_type, preferred_language from public.accounts where id = $1`, [r.rows[0].id]);
(r.rows[0].sms_consent === false && r.rows[0].sms_consent_text === null && r.rows[0].rep_code === null && r.rows[0].business_type === null && r.rows[0].preferred_language === "en" ? ok : bad)(`optional details stay empty: ${JSON.stringify(r.rows[0])}`);

await db.exec(`reset role; update public.accounts set active = false where id = '${A}';`);
await as(U1);
r = await db.query(`select count(*)::int n from public.orders`); (r.rows[0].n === 0 ? ok : bad)("switched-off account hides its orders");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])], "42501", "switched-off account cannot order");
r = await db.query(`select count(*)::int n from public.my_prices($1)`, [A]); (r.rows[0].n === 0 ? ok : bad)("switched-off account sees no prices");

await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select * from public.my_prices($1)`, [A], "42501", "anon cannot call my_prices");
await expectError(`select * from public.order_fees()`, [], "42501", "anon cannot call order_fees");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, "[]"], "42501", "anon cannot call place_order");
await expectError(`select public.create_my_account('X', 'Y', '+14045550123', '1 Main St', 'Atlanta', '30303')`, [], "42501", "anon cannot create accounts");
await expectError(`select * from public.accounts`, [], "42501", "anon cannot read accounts");
await expectError(`select * from public.pricing`, [], "42501", "anon cannot read pricing");
await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select * from public.load_costs($1)`, ["CUP-PET-16\t1"], "42501", "anon cannot load costs");
await as(U1);
await expectError(`select * from public.load_costs($1)`, ["CUP-PET-16\t1"], "42501", "customers cannot load costs");
await db.exec(`reset role;`);

// Pasted from a spreadsheet: header, blank cost, currency formatting, lower case, Windows line ends.
const sheet = "SKU\tCost per case\tProduct\r\nCUP-PET-16\t41.5\tClear cold cups\r\nLID-DOME-98H\t\tDome lids\r\nHBG-96N\t$1,234.50\tSugarcane hinged\r\npor-020c\t25\r\n\r\nNEW-SKU-1\t0\tzero\r\n";
r = await db.query(`select * from public.load_costs($1)`, [sheet]);
(r.rows[0].saved === 3 && r.rows[0].skipped === 3 && r.rows[0].check_these.length === 0 ? ok : bad)(`load_costs saved ${r.rows[0].saved}, skipped ${r.rows[0].skipped} (want 3 and 3)`);
r = await db.query(`select sku, cost_per_case::text c from public.product_costs where sku in ('CUP-PET-16','HBG-96N','POR-020C','LID-DOME-98H','NEW-SKU-1') order by sku`);
const got = Object.fromEntries(r.rows.map((x) => [x.sku, x.c]));
(got["CUP-PET-16"] === "41.50" && got["HBG-96N"] === "1234.50" && got["POR-020C"] === "25.00" && !("LID-DOME-98H" in got) && !("NEW-SKU-1" in got) ? ok : bad)(`costs after load: ${JSON.stringify(got)}`);
// Copied with spaces instead of tabs.
r = await db.query(`select * from public.load_costs($1)`, ["CUP-PET-16     40\nHBG-96N   33.333\n"]);
r = await db.query(`select sku, cost_per_case::text c from public.product_costs where sku in ('CUP-PET-16','HBG-96N') order by sku`);
(r.rows[0].c === "40.00" && r.rows[1].c === "33.33" ? ok : bad)(`space-separated paste updates costs: ${r.rows.map((x) => x.c).join(", ")}`);
r = await db.query(`select * from public.load_costs($1)`, [""]);
(r.rows[0].saved === 0 && r.rows[0].skipped === 0 && r.rows[0].check_these.length === 0 ? ok : bad)("empty paste does nothing");
// Comma decimals, negatives and huge numbers are reported, never guessed.
r = await db.query(`select * from public.load_costs($1)`, ["SKU\tCost per case\nPOR-020C\t40,00\nCUP-PET-16\t($12.00)\nHBG-96N\t123456789\nLID-DOME-98H\t-\nLID-DOME-98H\t0\n"]);
(r.rows[0].saved === 0 && r.rows[0].skipped === 6 && JSON.stringify(r.rows[0].check_these) === JSON.stringify(["POR-020C: 40,00", "CUP-PET-16: ($12.00)", "HBG-96N: 123456789"]) ? ok : bad)(`unreadable amounts listed: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select sku, cost_per_case::text c from public.product_costs where sku in ('CUP-PET-16','HBG-96N','POR-020C') order by sku`);
(r.rows.map((x) => x.c).join(",") === "40.00,33.33,25.00" ? ok : bad)(`unreadable amounts leave costs unchanged: ${r.rows.map((x) => x.c).join(", ")}`);
// Same call the guide gives, with dollar quoting.
r = await db.query(`select * from public.load_costs($sheet$
SKU	Cost per case
POR-020C	26.75
$sheet$)`);
r = await db.query(`select cost_per_case::text c from public.product_costs where sku = 'POR-020C'`);
(r.rows[0].c === "26.75" ? ok : bad)(`guide's dollar-quoted call works (${r.rows[0].c})`);
// Changing the margin changes prices for new orders only.
await db.exec(`update public.pricing set margin = 0.20`);
await as(U2);
r = await db.query(`select price_per_case::text p from public.my_prices($1) where sku = 'CUP-PET-16'`, [B]);
(r.rows[0].p === "50.00" ? ok : bad)(`new margin applies at once: ${r.rows[0].p} (40 / 0.80)`);
r = await db.query(`select price_per_case::text p from public.order_lines`);
(r.rows[0].p === "53.33" ? ok : bad)(`old orders keep their prices: ${r.rows[0].p}`);
await db.exec(`reset role; update public.pricing set margin = 0.25`);
// With no fees, as production has since Nov 12: an order still copies both fees, at $0, and its total is its subtotal.
await db.exec(`update public.pricing set delivery_fee = 0, next_day_fee = 0`);
await as(U2);
r = await db.query(`select delivery_fee::text d, next_day_fee::text n from public.order_fees()`);
(r.rows[0].d === "0.00" && r.rows[0].n === "0.00" ? ok : bad)(`customers see no fees: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select * from public.place_order($1, $2::jsonb, null, 'en', true)`, [B, JSON.stringify([{ sku: "CUP-PET-16", cases: 2 }])]);
const free = r.rows[0];
(Number(free.order_subtotal) === 106.66 && Number(free.order_total) === 106.66 ? ok : bad)(`with no fees a next-day order's total is its subtotal: ${free.order_subtotal}, ${free.order_total} (2 x 53.33)`);
r = await db.query(`select next_day, delivery_fee::text d, next_day_fee::text n from public.orders where id = $1`, [free.order_id]);
(r.rows[0].next_day === true && r.rows[0].d === "0.00" && r.rows[0].n === "0.00" ? ok : bad)(`the order keeps next-day and copies both fees at $0: ${JSON.stringify(r.rows[0])}`);
await db.exec(`reset role; update public.pricing set delivery_fee = 50, next_day_fee = 50`);

// link_customer: the dashboard helper for adding people to accounts.
await db.exec(`reset role;`);
await expectError(`select * from public.link_customer('d@x.com', 'Falafel Co')`, [], "P0002", "link_customer needs the user to exist first");
const U4 = "44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users values ('${U4}', 'd@x.com');`);
r = await db.query(`select * from public.link_customer(' D@X.com ', 'Falafel Co')`);
(r.rows.length === 1 && r.rows[0].account_name === "Falafel Co" && r.rows[0].email === "d@x.com" && r.rows[0].role === "owner" && !("tier" in r.rows[0]) ? ok : bad)(`link_customer creates the account and links the owner: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select * from public.link_customer('d@x.com', 'falafel co', 'buyer')`);
const n = await db.query(`select count(*)::int n from public.accounts where lower(name) = 'falafel co'`);
(r.rows[0].role === "buyer" && n.rows[0].n === 1 ? ok : bad)(`running it again changes the role, no duplicate account (${r.rows[0].role}, ${n.rows[0].n})`);
await expectError(`select * from public.link_customer('d@x.com', 'Falafel Co', 'admin')`, [], "22023", "link_customer rejects unknown roles");
await db.exec(`insert into public.accounts (name) values ('Taco Spot');`);
await expectError(`select * from public.link_customer('d@x.com', 'Taco Spot')`, [], "21000", "link_customer refuses ambiguous account names");
await as(U4);
r = await db.query(`select name from public.accounts`);
(r.rows.length === 1 && r.rows[0].name === "Falafel Co" ? ok : bad)(`linked user can read the new account: ${JSON.stringify(r.rows)}`);
await expectError(`select * from public.link_customer('d@x.com', 'Kebab House')`, [], "42501", "customers cannot link themselves to accounts");
await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select * from public.link_customer('d@x.com', 'Kebab House')`, [], "42501", "anon cannot link customers");
await db.exec(`reset role;`);

// priced_skus: the site's server asks which SKUs have a cost. The answer holds SKUs only.
const asServer = () => db.exec(`reset role; set role service_role; select set_config('request.jwt.claims', '', false);`);
await asServer();
r = await db.query(`select public.priced_skus() skus`);
(JSON.stringify(r.rows[0].skus) === JSON.stringify(["CUP-PET-16", "HBG-96N", "POR-020C"]) ? ok : bad)(`the server key gets the SKUs that have a cost, in order: ${JSON.stringify(r.rows[0].skus)}`);
r = await db.query(`select pg_typeof(public.priced_skus())::text t, prosecdef from pg_proc where proname = 'priced_skus'`);
(r.rows.length === 1 && r.rows[0].t === "text[]" && r.rows[0].prosecdef === false ? ok : bad)(`priced_skus returns SKUs only, with the caller's rights: ${JSON.stringify(r.rows)}`);
await as(U1);
await expectError(`select public.priced_skus()`, [], "42501", "customers cannot call priced_skus");
await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select public.priced_skus()`, [], "42501", "anon cannot call priced_skus");
// A new cost shows up in the list; with no costs at all the list is empty, never null.
await db.exec(`reset role; select * from public.load_costs('LID-DOME-98H	30');`);
await asServer();
r = await db.query(`select public.priced_skus() skus`);
(r.rows[0].skus.length === 4 && r.rows[0].skus.includes("LID-DOME-98H") ? ok : bad)(`a newly loaded cost joins the list (${r.rows[0].skus.length} SKUs)`);
await db.exec(`reset role; begin; delete from public.product_costs;`);
await asServer();
r = await db.query(`select public.priced_skus() skus`);
(Array.isArray(r.rows[0].skus) && r.rows[0].skus.length === 0 ? ok : bad)(`no costs gives an empty list: ${JSON.stringify(r.rows[0].skus)}`);
await db.exec(`reset role; rollback;`);
r = await db.query(`select count(*)::int n from public.product_costs`);
(r.rows[0].n === 4 ? ok : bad)(`costs untouched after the empty-list check (${r.rows[0].n})`);

// Self-service: the owner corrects the business details; any member cancels an order that is still received.
await db.exec(`reset role;
  insert into public.account_users (account_id, user_id, role) values ('${A}', '${U3}', 'buyer') on conflict do nothing;`);
// Kebab House was switched off further up: its owner can change nothing until it is back on.
await as(U1);
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [A, "Kebab House", "Ali", "+14045550188", "1 St", "Atlanta", "30309"], "42501", "a switched-off account cannot change its details");
await db.exec(`reset role; update public.accounts set active = true where id = '${A}';`);
await as(U1);
await db.query(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7, $8)`, [A, "  Kebab House Midtown ", " Ali ", "+14045550188", " 77 Tenth St ", " Atlanta ", "30309", "tr"]);
r = await db.query(`select name, contact_name, phone, street, city, zip, preferred_language from public.accounts where id = $1`, [A]);
(JSON.stringify(r.rows[0]) === JSON.stringify({ name: "Kebab House Midtown", contact_name: "Ali", phone: "+14045550188", street: "77 Tenth St", city: "Atlanta", zip: "30309", preferred_language: "tr" }) ? ok : bad)(`the owner changes the business details, trimmed: ${JSON.stringify(r.rows[0])}`);
await db.query(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7, $8)`, [A, "Kebab House", "Ali", "+14045550188", "77 Tenth St", "Atlanta", "30309", "xx"]);
r = await db.query(`select name, preferred_language from public.accounts where id = $1`, [A]);
(r.rows[0].name === "Kebab House" && r.rows[0].preferred_language === "tr" ? ok : bad)(`an unknown language leaves the language as it was (${r.rows[0].preferred_language})`);
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [A, " ", "Ali", "+14045550188", "77 Tenth St", "Atlanta", "30309"], "22023", "details need a business name");
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [A, "Kebab House", "Ali", "404-555-0188", "77 Tenth St", "Atlanta", "30309"], "23514", "details keep the phone format");
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [A, "Kebab House", "Ali", "+14045550188", "77 Tenth St", "Atlanta", "3030"], "23514", "details keep the ZIP format");
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [B, "Mine now", "Ali", "+14045550188", "1 St", "Atlanta", "30309"], "42501", "an owner cannot change another business");
await expectError(`update public.accounts set name = 'Direct' where id = $1`, [A], "42501", "details change only through the function");
await as(U3);
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [A, "Buyer Was Here", "Bo", "+14045550188", "1 St", "Atlanta", "30309"], "42501", "a buyer cannot change the business details");
r = await db.query(`select contact_name, phone, street, city, zip, preferred_language from public.accounts where id = $1`, [A]);
(r.rows.length === 1 && r.rows[0].street === "77 Tenth St" ? ok : bad)(`a member reads the details of their business (${r.rows.length} row)`);
r = await db.query(`select count(*)::int n from public.accounts where id = $1`, [B]);
(r.rows[0].n === 0 ? ok : bad)("and not another business's");
await db.exec(`reset role;`);
r = await db.query(`select details_updated_at is not null stamped from public.accounts where id = $1`, [A]);
(r.rows[0].stamped ? ok : bad)("the change is stamped with its time");

// Cancel: a fresh order, placed by the owner, canceled by the buyer on the same account.
await as(U1);
r = await db.query(`select order_number n from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])]);
const N1 = Number(r.rows[0].n);
r = await db.query(`select order_number n from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 2 }])]);
const N2 = Number(r.rows[0].n);
await as(U2);
await expectError(`select public.cancel_my_order($1, $2)`, [A, N1], "42501", "someone from another business cannot cancel the order");
r = await db.query(`select public.cancel_my_order($1, $2) s`, [B, N1]);
(r.rows[0].s === "not_found" ? ok : bad)(`an order number from another business is not found (${r.rows[0].s})`);
await as(U3);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, N1]);
(r.rows[0].s === "canceled" ? ok : bad)(`a member cancels a received order (${r.rows[0].s})`);
r = await db.query(`select status, canceled_at is not null stamped from public.orders where number = $1`, [N1]);
(r.rows[0].status === "canceled" && r.rows[0].stamped ? ok : bad)(`the order reads canceled, with the time (${JSON.stringify(r.rows[0])})`);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, N1]);
(r.rows[0].s === "canceled" ? ok : bad)("canceling it again changes nothing and still says canceled");
await db.exec(`reset role;`);
r = await db.query(`select canceled_by::text u from public.orders where number = $1`, [N1]);
(r.rows[0].u === U3 ? ok : bad)("the order records who canceled it");
await db.query(`update public.orders set status = 'confirmed' where number = $1`, [N2]);
await as(U1);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, N2]);
const still = await db.query(`select status from public.orders where number = $1`, [N2]);
(r.rows[0].s === "too_late" && still.rows[0].status === "confirmed" ? ok : bad)(`a confirmed order is too late to cancel and stays confirmed (${r.rows[0].s}, ${still.rows[0].status})`);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, 999999]);
(r.rows[0].s === "not_found" ? ok : bad)("an unknown order number is not found");
await expectError(`update public.orders set status = 'canceled' where number = $1`, [N2], "42501", "orders change only through the function");
await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select public.cancel_my_order($1, $2)`, [A, N2], "42501", "anon cannot cancel orders");
await expectError(`select public.update_my_account($1, $2, $3, $4, $5, $6, $7)`, [A, "x", "x", "+14045550188", "x", "x", "30309"], "42501", "anon cannot change details");
await db.exec(`reset role;`);

// Weekly order, part 1. First the calendar: orders close at 5 pm Eastern, two days before the delivery date.
const nd = async (day, now) => (await db.query(`select delivery_date::text d, to_char(closes_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') c from public.next_delivery($1, $2::timestamptz)`, [day, now])).rows[0];
r = await nd("thu", "2026-11-11 12:00:00-05");
(r?.d === "2026-11-19" && r?.c === "2026-11-17 22:00" ? ok : bad)(`Wednesday noon, Thursday delivery: this week's order has closed, next is Nov 19 and closes Tuesday 5 pm ET (${JSON.stringify(r)})`);
r = await nd("fri", "2026-11-11 12:00:00-05");
(r?.d === "2026-11-13" && r?.c === "2026-11-11 22:00" ? ok : bad)(`Wednesday noon, Friday delivery: still open until 5 pm today (${JSON.stringify(r)})`);
r = await nd("fri", "2026-11-11 17:00:00-05");
(r?.d === "2026-11-20" ? ok : bad)(`at 5 pm sharp the order has closed (${JSON.stringify(r)})`);
r = await nd("tue", "2027-03-13 12:00:00-05");
(r?.d === "2027-03-16" && r?.c === "2027-03-14 21:00" ? ok : bad)(`5 pm follows the clock change in March (${JSON.stringify(r)})`);
r = await nd("mon", "2026-11-14 18:00:00-05");
(r?.d === "2026-11-23" ? ok : bad)(`Saturday evening, Monday delivery: this Monday's order closed at 5 pm (${JSON.stringify(r)})`);
r = await db.query(`select ((select count(*) from public.next_delivery('sun')) + (select count(*) from public.next_delivery(null)))::int n`);
(r.rows[0].n === 0 ? ok : bad)("no delivery date without a delivery day");
r = await db.query(`select prosecdef from pg_proc where proname = 'next_delivery'`);
(r.rows[0].prosecdef === false ? ok : bad)("next_delivery runs with the caller's rights");

// Asking for it, skipping, turning it off.
await as(U1);
r = await db.query(`select public.weekly_orders_live() live`);
(r.rows[0].live === false ? ok : bad)("weekly orders start switched off for the whole site");
await db.exec(`reset role; delete from public.usual_orders where account_id = '${A}';`);
await as(U1);
await expectError(`select public.set_weekly_order($1, true)`, [A], "22023", "a weekly order needs a saved usual order");
await db.query(`select public.save_usual_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 4 }])]);
await db.query(`select public.set_weekly_order($1, true)`, [A]);
r = await db.query(`select weekly, weekly_since is not null since, skip_date from public.usual_orders where account_id = $1`, [A]);
(r.rows[0].weekly === true && r.rows[0].since && r.rows[0].skip_date === null ? ok : bad)(`a member turns the weekly order on (${JSON.stringify(r.rows[0])})`);
r = await db.query(`select public.skip_weekly_order($1, true)::text d, (select delivery_date::text from public.next_delivery('thu')) want`, [A]);
const skipped = await db.query(`select skip_date::text d from public.usual_orders where account_id = $1`, [A]);
(r.rows[0].d === r.rows[0].want && skipped.rows[0].d === r.rows[0].want ? ok : bad)(`skipping marks the coming delivery date (${r.rows[0].d})`);
await db.query(`select public.skip_weekly_order($1, false)`, [A]);
r = await db.query(`select skip_date from public.usual_orders where account_id = $1`, [A]);
(r.rows[0].skip_date === null ? ok : bad)("the skip can be taken back");
await db.query(`select public.skip_weekly_order($1, true)`, [A]);
await db.query(`select public.set_weekly_order($1, false)`, [A]);
r = await db.query(`select weekly, weekly_since, skip_date from public.usual_orders where account_id = $1`, [A]);
(r.rows[0].weekly === false && r.rows[0].weekly_since === null && r.rows[0].skip_date === null ? ok : bad)("turning it off forgets the skip");
await expectError(`select public.skip_weekly_order($1, true)`, [A], "22023", "nothing to skip while the weekly order is off");
await expectError(`update public.usual_orders set weekly = true where account_id = $1`, [A], "42501", "the weekly order changes only through the functions");
await as(U2);
await expectError(`select public.set_weekly_order($1, true)`, [A], "42501", "someone from another business cannot turn it on");
await expectError(`select public.skip_weekly_order($1, true)`, [A], "42501", "or skip it");
// Taco Spot has no delivery day: it can ask, and has nothing to skip yet.
await db.exec(`reset role; update public.accounts set active = true where id = '${B}';`);
await as(U2);
await db.query(`select public.save_usual_order($1, $2::jsonb)`, [B, JSON.stringify([{ sku: "HBG-96N", cases: 1 }])]);
await db.query(`select public.set_weekly_order($1, true)`, [B]);
await expectError(`select public.skip_weekly_order($1, true)`, [B], "22023", "no delivery day yet means nothing to skip");
await db.exec(`reset role; update public.pricing set weekly_orders_on = true;`);
await as(U2);
r = await db.query(`select public.weekly_orders_live() live`);
(r.rows[0].live === true ? ok : bad)("customers see the switch once it is on");
await expectError(`select weekly_orders_on from public.pricing`, [], "42501", "and still cannot read the pricing table");
await db.exec(`reset role; update public.pricing set weekly_orders_on = false; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select public.set_weekly_order($1, true)`, [A], "42501", "anon cannot turn a weekly order on");
await expectError(`select public.weekly_orders_live()`, [], "42501", "anon cannot ask about the switch");
await db.exec(`reset role;`);
// Payments. Every order has a pay link; the site's server reads the order behind it and records what Stripe says.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const placeFor = async (account, lines) => (await db.query(`select order_id id, order_number n from public.place_order($1, $2::jsonb)`, [account, JSON.stringify(lines)])).rows[0];
const pay = (order, status, intent, method = null, fee = 0, amount = null) =>
  db.query(`select * from public.set_order_payment($1, $2, $3, $4, $5, $6)`, [order, status, intent, method, fee, amount]);
const paymentOf = async (id) => (await db.query(
  `select payment_status s, payment_method m, card_fee::text f, payment_amount::text a, paid_at is not null paid, stripe_payment_intent i, payment_updated_at is not null touched from public.orders where id = $1`, [id])).rows[0];
await as(U1);
const P1 = await placeFor(A, [{ sku: "CUP-PET-16", cases: 2 }]);
r = await db.query(`select pay_token::text t, payment_status s, payment_method m, card_fee, payment_amount, paid_at, payment_updated_at from public.orders where id = $1`, [P1.id]);
const T1 = r.rows[0].t;
(UUID.test(T1) && r.rows[0].s === "unpaid" && r.rows[0].m === null && r.rows[0].card_fee === null && r.rows[0].payment_amount === null && r.rows[0].paid_at === null ? ok : bad)(`a member reads an order's pay link and that it is unpaid: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select count(distinct pay_token)::int d, count(*)::int n from public.orders`);
(r.rows[0].d === r.rows[0].n ? ok : bad)(`every order has its own pay link (${r.rows[0].d} links, ${r.rows[0].n} orders)`);
await expectError(`select stripe_payment_intent from public.orders where id = $1`, [P1.id], "42501", "customers cannot read the Stripe id");
await expectError(`update public.orders set payment_status = 'paid' where id = $1`, [P1.id], "42501", "customers cannot mark an order paid");
await expectError(`select * from public.order_for_pay($1)`, [T1], "42501", "customers cannot call order_for_pay");
await expectError(`select * from public.set_order_payment($1, 'paid', 'pi_x', 'bank', 0, 1)`, [P1.id], "42501", "customers cannot record a payment");
await as(U2);
r = await db.query(`select count(*)::int n from public.orders where pay_token = $1`, [T1]);
(r.rows[0].n === 0 ? ok : bad)("another business cannot read the order or its pay link");
await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select * from public.order_for_pay($1)`, [T1], "42501", "anon cannot call order_for_pay");
await expectError(`select * from public.set_order_payment($1, 'paid', 'pi_x', 'bank', 0, 1)`, [P1.id], "42501", "anon cannot record a payment");
await expectError(`select pay_token from public.orders`, [], "42501", "anon cannot read pay links");

await asServer();
r = await db.query(`select order_id, order_number, account_name, status, amount_due::text due, site_locale, lines, payment_status, payment_method, card_fee, payment_amount, paid_at from public.order_for_pay($1)`, [T1]);
const due = r.rows[0];
(r.rows.length === 1 && due.order_id === P1.id && Number(due.order_number) === Number(P1.n) && due.account_name === "Kebab House" && due.status === "received" &&
  due.due === "156.66" && due.site_locale === "en" && JSON.stringify(due.lines) === JSON.stringify([{ sku: "CUP-PET-16", cases: 2, price: 53.33 }]) &&
  due.payment_status === "unpaid" && due.payment_method === null && due.paid_at === null ? ok : bad)(`the server key reads the order behind a pay link: ${JSON.stringify(due)} (2 x 53.33 + 50 delivery = 156.66)`);
r = await db.query(`select * from public.order_for_pay(gen_random_uuid())`);
(r.rows.length === 0 ? ok : bad)("an unknown pay link finds nothing");
r = await db.query(`select prosecdef from pg_proc where proname in ('order_for_pay', 'set_order_payment') order by proname`);
(r.rows.length === 2 && r.rows.every((x) => x.prosecdef) ? ok : bad)("both payment functions run with the owner's rights, behind their grants");

// A bank payment: on its way, then in. Repeats and stray news change nothing.
r = await pay(P1.id, "failed", "pi_declined1");
(r.rows[0]?.result === "ignored" && (await paymentOf(P1.id)).s === "unpaid" ? ok : bad)(`a declined card the customer replaced leaves the order unpaid (${r.rows[0]?.result})`);
r = await pay(P1.id, "processing", "pi_bank1", "bank", 0, 156.66);
let row = r.rows[0];
(row?.result === "changed" && Number(row.order_number) === Number(P1.n) && row.account_name === "Kebab House" && row.pay_token === T1 && row.site_locale === "en" && row.order_status === "received" ? ok : bad)(`a bank payment on its way is recorded, with what the team's email needs: ${JSON.stringify(row)}`);
let pm = await paymentOf(P1.id);
(pm.s === "processing" && pm.m === "bank" && pm.f === "0.00" && pm.a === "156.66" && !pm.paid && pm.i === "pi_bank1" && pm.touched ? ok : bad)(`the order reads processing, by bank: ${JSON.stringify(pm)}`);
r = await pay(P1.id, "processing", "pi_bank1", "bank", 0, 156.66);
(r.rows[0]?.result === "same" ? ok : bad)(`the same news twice is "same" (${r.rows[0]?.result})`);
r = await pay(P1.id, "processing", "pi_bank2", "bank", 0, 156.66);
(r.rows[0]?.result === "twice" && (await paymentOf(P1.id)).i === "pi_bank1" ? ok : bad)(`a second bank payment while one is on its way is flagged and the first stays (${r.rows[0]?.result})`);
r = await pay(P1.id, "paid", "pi_bank1", "bank", 0, 156.66);
pm = await paymentOf(P1.id);
(r.rows[0]?.result === "changed" && pm.s === "paid" && pm.paid && pm.a === "156.66" && pm.i === "pi_bank1" ? ok : bad)(`the bank payment comes in: ${JSON.stringify(pm)}`);
r = await pay(P1.id, "processing", "pi_bank1", "bank", 0, 156.66);
(r.rows[0]?.result === "same" && (await paymentOf(P1.id)).s === "paid" ? ok : bad)(`"on its way" arriving after "paid" changes nothing (${r.rows[0]?.result})`);
r = await pay(P1.id, "failed", "pi_bank1");
(r.rows[0]?.result === "ignored" && (await paymentOf(P1.id)).s === "paid" ? ok : bad)(`a paid order stays paid (${r.rows[0]?.result})`);
r = await pay(P1.id, "paid", "pi_card9", "credit_card", 4.54, 161.20);
pm = await paymentOf(P1.id);
(r.rows[0]?.result === "twice" && pm.i === "pi_bank1" && pm.m === "bank" ? ok : bad)(`a second payment for a paid order is flagged and the first stays: ${r.rows[0]?.result}, ${JSON.stringify(pm)}`);

// A credit card with its fee; a bank payment that fails, then a debit card; a card that comes in while a bank payment is on its way.
await as(U1);
const P2 = await placeFor(A, [{ sku: "CUP-PET-16", cases: 2 }]);
const P3 = await placeFor(A, [{ sku: "HBG-96N", cases: 1 }]);
const P4 = await placeFor(A, [{ sku: "HBG-96N", cases: 2 }]);
await asServer();
r = await pay(P2.id, "paid", "pi_card1", "credit_card", 4.54, 161.20);
pm = await paymentOf(P2.id);
(r.rows[0]?.result === "changed" && pm.s === "paid" && pm.m === "credit_card" && pm.f === "4.54" && pm.a === "161.20" && pm.paid ? ok : bad)(`a credit card payment keeps its fee: ${JSON.stringify(pm)} (156.66 x 2.9% = 4.54)`);
await pay(P3.id, "processing", "pi_bank3", "bank", 0, 94.44);
r = await pay(P3.id, "failed", "pi_bank3");
pm = await paymentOf(P3.id);
(r.rows[0]?.result === "changed" && pm.s === "failed" && pm.i === "pi_bank3" ? ok : bad)(`a bank payment that fails marks the order failed: ${JSON.stringify(pm)}`);
r = await pay(P3.id, "failed", "pi_bank3");
(r.rows[0]?.result === "same" ? ok : bad)(`and saying so again is "same" (${r.rows[0]?.result})`);
r = await pay(P3.id, "paid", "pi_card3", "debit_card", 0, 94.44);
pm = await paymentOf(P3.id);
(r.rows[0]?.result === "changed" && pm.s === "paid" && pm.m === "debit_card" && pm.f === "0.00" && pm.i === "pi_card3" ? ok : bad)(`paying again after a failure works: ${JSON.stringify(pm)}`);
await pay(P4.id, "processing", "pi_bank4", "bank", 0, 138.88);
r = await pay(P4.id, "paid", "pi_card4", "credit_card", 4.03, 142.91);
pm = await paymentOf(P4.id);
(r.rows[0]?.result === "twice" && pm.s === "paid" && pm.i === "pi_card4" && pm.f === "4.03" ? ok : bad)(`a card that comes in while a bank payment is on its way becomes the payment, flagged twice: ${r.rows[0]?.result}, ${JSON.stringify(pm)}`);
r = await pay(P4.id, "failed", "pi_bank4");
(r.rows[0]?.result === "ignored" && (await paymentOf(P4.id)).s === "paid" ? ok : bad)(`the bank payment failing later leaves it paid (${r.rows[0]?.result})`);

// What set_order_payment refuses.
await expectError(`select * from public.set_order_payment($1, 'refunded', 'pi_x')`, [P1.id], "22023", "only processing, paid or failed");
await expectError(`select * from public.set_order_payment($1, 'paid', 'ch_123', 'bank', 0, 1)`, [P1.id], "22023", "a payment needs a Stripe payment id");
await expectError(`select * from public.set_order_payment($1, 'paid', 'pi_x', 'cash', 0, 1)`, [P1.id], "22023", "a payment needs a known method");
await expectError(`select * from public.set_order_payment($1, 'paid', 'pi_x', 'bank', 0, null)`, [P1.id], "22023", "a payment needs an amount");
await expectError(`select * from public.set_order_payment($1, 'paid', 'pi_x', 'bank', -1, 10)`, [P1.id], "22023", "a fee is never negative");
r = await pay("99999999-9999-9999-9999-999999999999", "paid", "pi_x", "bank", 0, 1);
(r.rows.length === 0 ? ok : bad)("an unknown order answers no row");
await db.exec(`reset role;`);
await expectError(`update public.orders set payment_status = 'refunded' where id = $1`, [P1.id], "23514", "the table holds only the four payment states");
await expectError(`update public.orders set stripe_payment_intent = 'ch_1' where id = $1`, [P1.id], "23514", "the table holds only Stripe payment ids");

// Customers see it on their orders; a paid order, or one with a bank payment on its way, is not canceled on the site.
await as(U1);
r = await db.query(`select payment_status s, payment_method m, card_fee::text f, payment_amount::text a, paid_at is not null paid from public.orders where id = $1`, [P2.id]);
(JSON.stringify(r.rows[0]) === JSON.stringify({ s: "paid", m: "credit_card", f: "4.54", a: "161.20", paid: true }) ? ok : bad)(`the customer sees the payment and its fee: ${JSON.stringify(r.rows[0])}`);
const P5 = await placeFor(A, [{ sku: "CUP-PET-16", cases: 1 }]);
const P6 = await placeFor(A, [{ sku: "CUP-PET-16", cases: 1 }]);
const P7 = await placeFor(A, [{ sku: "CUP-PET-16", cases: 1 }]);
await asServer();
await pay(P5.id, "processing", "pi_bank5", "bank", 0, 103.33);
await pay(P7.id, "processing", "pi_bank7", "bank", 0, 103.33);
await pay(P7.id, "failed", "pi_bank7");
await as(U1);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, P2.n]);
let st = await db.query(`select status from public.orders where id = $1`, [P2.id]);
(r.rows[0].s === "paid" && st.rows[0].status === "received" ? ok : bad)(`a paid order is not canceled on the site (${r.rows[0].s}, ${st.rows[0].status})`);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, P5.n]);
st = await db.query(`select status from public.orders where id = $1`, [P5.id]);
(r.rows[0].s === "paid" && st.rows[0].status === "received" ? ok : bad)(`nor one with a bank payment on its way (${r.rows[0].s}, ${st.rows[0].status})`);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, P7.n]);
(r.rows[0].s === "canceled" ? ok : bad)(`a failed payment does not stop a cancel (${r.rows[0].s})`);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, P6.n]);
(r.rows[0].s === "canceled" ? ok : bad)(`an unpaid order is still canceled as before (${r.rows[0].s})`);
r = await db.query(`select public.cancel_my_order($1, $2) s`, [A, N2]);
(r.rows[0].s === "too_late" ? ok : bad)(`a confirmed, unpaid order is still too late (${r.rows[0].s})`);

// The pay page reads payments and canceled orders; old orders come to their subtotal; an unpriced one has nothing due yet.
await db.exec(`reset role;`);
const tokenOf = async (id) => (await db.query(`select pay_token::text t from public.orders where id = $1`, [id])).rows[0].t;
await asServer();
r = await db.query(`select payment_status s, payment_method m, card_fee::text f, payment_amount::text a, paid_at is not null paid from public.order_for_pay($1)`, [await tokenOf(P2.id)]);
(JSON.stringify(r.rows[0]) === JSON.stringify({ s: "paid", m: "credit_card", f: "4.54", a: "161.20", paid: true }) ? ok : bad)(`the pay page reads a payment: ${JSON.stringify(r.rows[0])}`);
r = await db.query(`select status from public.order_for_pay($1)`, [await tokenOf(P6.id)]);
(r.rows[0].status === "canceled" ? ok : bad)("the pay page reads that an order was canceled");
r = await db.query(`select amount_due from public.order_for_pay($1)`, [await tokenOf(o1.order_id)]);
(r.rows[0].amount_due === null ? ok : bad)(`an order with a price still to confirm has nothing due yet (${r.rows[0].amount_due})`);
await db.exec(`reset role;`);
r = await db.query(`insert into public.orders (account_id, subtotal) values ($1, 12.34) returning pay_token::text t`, [A]);
await asServer();
r = await db.query(`select amount_due::text d from public.order_for_pay($1)`, [r.rows[0].t]);
(r.rows[0].d === "12.34" ? ok : bad)(`an order from before delivery fees comes to its subtotal (${r.rows[0].d})`);
await db.exec(`reset role;`);

// Orders placed before the payments migration each get their own pay link, unpaid.
{
  const old = new PGlite();
  await supabaseStandIns(old);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== PAYMENTS).sort()) await old.exec(readFileSync(`${dir}/${f}`, "utf8"));
  await old.exec(`insert into public.accounts (id, name) values ('${A}', 'Kebab House');
    insert into public.orders (account_id, subtotal) values ('${A}', 10), ('${A}', 20), ('${A}', 30);`);
  await old.exec(readFileSync(`${dir}/${PAYMENTS}`, "utf8"));
  const o = await old.query(`select count(*)::int n, count(distinct pay_token)::int d, bool_and(payment_status = 'unpaid') u, bool_and(pay_token is not null) t from public.orders`);
  (o.rows[0].n === 3 && o.rows[0].d === 3 && o.rows[0].u && o.rows[0].t ? ok : bad)(`orders placed before the migration each get their own pay link, unpaid: ${JSON.stringify(o.rows[0])}`);
  await old.close();
}

console.log(process.exitCode ? "SOME TESTS FAILED" : "ALL PASSED");
