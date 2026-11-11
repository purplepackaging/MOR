import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const dir = process.argv[2] ?? new URL("../../supabase/migrations", import.meta.url).pathname;
const db = new PGlite();
const ok = (m) => console.log("PASS", m);
const bad = (m) => { console.log("FAIL", m); process.exitCode = 1; };
async function expectError(sql, params, code, label) {
  try { await db.query(sql, params); bad(`${label}: no error`); }
  catch (e) { (e.code === code ? ok : bad)(`${label} -> ${e.code} ${e.message}`); }
}
const run = (f) => db.exec(readFileSync(`${dir}/${f}`, "utf8"));
// Supabase stand-ins
await db.exec(`
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
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
               alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
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

let r = await db.query(`select to_regclass('public.price_tiers') t, (select count(*)::int from information_schema.columns where table_name = 'accounts' and column_name = 'tier') c`);
(r.rows[0].t === null && r.rows[0].c === 0 ? ok : bad)("tiers are gone");
r = await db.query(`select margin::text m, delivery_fee::text d, next_day_fee::text n, (select count(*)::int from public.pricing) rows from public.pricing`);
(r.rows[0].m === "0.2500" && r.rows[0].d === "50.00" && r.rows[0].n === "50.00" && r.rows[0].rows === 1 ? ok : bad)(`one pricing row: ${JSON.stringify(r.rows[0])}`);
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
console.log(process.exitCode ? "SOME TESTS FAILED" : "ALL PASSED");
