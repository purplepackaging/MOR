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
// Supabase stand-ins
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);
// Supabase grants broad default privileges in public; mimic that so the migration's revokes are tested.
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
               alter default privileges in schema public grant all on functions to anon, authenticated;`);
for (const f of ["20261109000000_init.sql", "20261110000000_portal.sql", "20261110155000_api_grants.sql"]) await db.exec(readFileSync(`${dir}/${f}`, "utf8"));
ok("migrations ran");
await db.exec(readFileSync(`${dir}/20261110000000_portal.sql`, "utf8"));
ok("portal migration is re-runnable");

const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222", U3 = "33333333-3333-3333-3333-333333333333";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
await db.exec(`
  insert into auth.users values ('${U1}','a@x.com'),('${U2}','b@x.com'),('${U3}','c@x.com');
  insert into public.accounts (id, name, tier, delivery_day) values ('${A}','Kebab House','M','thu'),('${B}','Taco Spot',null,null);
  insert into public.account_users (account_id, user_id, role) values ('${A}','${U1}','owner'),('${B}','${U2}','owner');
  insert into public.product_costs (sku, cost_per_case) values ('CUP-PET-16', 40.00), ('HBG-96N', 33.33);
`);
const as = async (uid) => { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false);`); };

await as(U1);
let r = await db.query(`select id, name, delivery_day from public.accounts`);
(r.rows.length === 1 && r.rows[0].name === "Kebab House" ? ok : bad)(`u1 sees only own account (${r.rows.length})`);
await expectError(`select tier from public.accounts`, [], "42501", "u1 cannot read tier");
await expectError(`select * from public.product_costs`, [], "42501", "u1 cannot read costs");
await expectError(`select * from public.price_tiers`, [], "42501", "u1 cannot read markups");
r = await db.query(`select * from public.my_prices($1) order by sku`, [A]);
const p = Object.fromEntries(r.rows.map((x) => [x.sku, Number(x.price_per_case)]));
(p["CUP-PET-16"] === 52 && p["HBG-96N"] === 43.33 ? ok : bad)(`tier M prices: ${JSON.stringify(p)} (40 x 1.30 = 52.00, 33.33 x 1.30 = 43.33)`);
r = await db.query(`select * from public.my_prices($1)`, [B]);
(r.rows.length === 0 ? ok : bad)("u1 gets no prices for someone else's account");

const lines = JSON.stringify([
  { sku: "CUP-PET-16", cases: 4 }, { sku: "CUP-PET-16", cases: 9 }, { sku: "HBG-96N", cases: 2 },
  { sku: "NOCOST-1", cases: 1 }, { sku: "bad sku", cases: 1 }, { sku: "LID-X", cases: 2.5 }, { sku: "LID-Y", cases: 0 }, { sku: "LID-Z", cases: 1000 }, "junk",
]);
r = await db.query(`select * from public.place_order($1, $2::jsonb, $3, $4)`, [A, lines, "  Back door please  ", "tr"]);
const o1 = r.rows[0];
(o1.order_number === 1001n || Number(o1.order_number) === 1001 ? ok : bad)(`first order number ${o1.order_number}`);
(o1.order_subtotal === null ? ok : bad)("subtotal is empty when a line has no cost");
r = await db.query(`select sku, cases, price_per_case from public.order_lines where order_id = $1 order by sku`, [o1.order_id]);
(JSON.stringify(r.rows.map((x) => [x.sku, x.cases, x.price_per_case === null ? null : Number(x.price_per_case)])) ===
  JSON.stringify([["CUP-PET-16", 4, 52], ["HBG-96N", 2, 43.33], ["NOCOST-1", 1, null]]) ? ok : bad)(`lines cleaned: ${JSON.stringify(r.rows)}`);
r = await db.query(`select note, site_locale from public.orders where id = $1`, [o1.order_id]).catch((e) => ({ rows: [{ err: e.code }] }));
(r.rows[0].err === "42501" ? ok : bad)("site_locale column is not readable by customers");
r = await db.query(`select note, status from public.orders where id = $1`, [o1.order_id]);
(r.rows[0].note === "Back door please" && r.rows[0].status === "received" ? ok : bad)(`note trimmed, status received`);
r = await db.query(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 3 }, { sku: "HBG-96N", cases: 1 }])]);
(Number(r.rows[0].order_subtotal) === 199.33 ? ok : bad)(`subtotal ${r.rows[0].order_subtotal} (3 x 52 + 43.33 = 199.33)`);
await expectError(`select * from public.place_order($1, $2::jsonb)`, [B, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])], "42501", "u1 cannot order for another account");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, "[]"], "22023", "empty order rejected");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "x", cases: 1 }])], "22023", "order with no valid lines rejected");
await expectError(`insert into public.orders (account_id) values ($1)`, [A], "42501", "no direct inserts into orders");
await expectError(`update public.orders set status = 'delivered'`, [], "42501", "customers cannot change status");
r = await db.query(`select * from public.save_usual_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "HBG-96N", cases: 3 }, { sku: "CUP-PET-16", cases: 2 }, { sku: "HBG-96N", cases: 7 }])]);
(r.rows[0].save_usual_order === 2 ? ok : bad)(`usual order saved with ${r.rows[0].save_usual_order} lines`);
r = await db.query(`select lines from public.usual_orders`);
(JSON.stringify(r.rows[0].lines) === JSON.stringify([{ sku: "HBG-96N", cases: 3 }, { sku: "CUP-PET-16", cases: 2 }]) ? ok : bad)(`usual order keeps list order: ${JSON.stringify(r.rows[0].lines)}`);
await expectError(`select * from public.save_usual_order($1, $2::jsonb)`, [B, "[]"], "42501", "u1 cannot save another account's usual order");
r = await db.query(`select count(*)::int n from public.orders`); (r.rows[0].n === 2 ? ok : bad)(`u1 sees own 2 orders`);

await as(U2);
r = await db.query(`select * from public.place_order($1, $2::jsonb)`, [B, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])]);
(r.rows[0].order_subtotal === null ? ok : bad)("no tier: order goes in without prices");
r = await db.query(`select count(*)::int n from public.orders`); (r.rows[0].n === 1 ? ok : bad)(`u2 sees only own order (${r.rows[0].n})`);
r = await db.query(`select count(*)::int n from public.order_lines`); (r.rows[0].n === 1 ? ok : bad)(`u2 sees only own lines (${r.rows[0].n})`);
r = await db.query(`select * from public.my_prices($1)`, [B]); (r.rows.length === 0 ? ok : bad)("no tier: no prices");
r = await db.query(`select count(*)::int n from public.usual_orders`); (r.rows[0].n === 0 ? ok : bad)("u2 cannot see u1's usual order");

await as(U3);
r = await db.query(`select count(*)::int n from public.accounts`); (r.rows[0].n === 0 ? ok : bad)("user with no account sees nothing");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])], "42501", "unlinked user cannot order");

await db.exec(`reset role; update public.accounts set active = false where id = '${A}';`);
await as(U1);
r = await db.query(`select count(*)::int n from public.orders`); (r.rows[0].n === 0 ? ok : bad)("paused account hides its orders");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, JSON.stringify([{ sku: "CUP-PET-16", cases: 1 }])], "42501", "paused account cannot order");

await db.exec(`reset role; set role anon; select set_config('request.jwt.claims', '', false);`);
await expectError(`select * from public.my_prices($1)`, [A], "42501", "anon cannot call my_prices");
await expectError(`select * from public.place_order($1, $2::jsonb)`, [A, "[]"], "42501", "anon cannot call place_order");
await expectError(`select * from public.accounts`, [], "42501", "anon cannot read accounts");
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
// link_customer: the dashboard helper for adding people to accounts.
await db.exec(`reset role;`);
await expectError(`select * from public.link_customer('d@x.com', 'Falafel Co')`, [], "P0002", "link_customer needs the user to exist first");
const U4 = "44444444-4444-4444-4444-444444444444";
await db.exec(`insert into auth.users values ('${U4}', 'd@x.com');`);
r = await db.query(`select * from public.link_customer(' D@X.com ', 'Falafel Co')`);
(r.rows.length === 1 && r.rows[0].account_name === "Falafel Co" && r.rows[0].email === "d@x.com" && r.rows[0].role === "owner" && r.rows[0].tier === null ? ok : bad)(`link_customer creates the account and links the owner: ${JSON.stringify(r.rows[0])}`);
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
console.log(process.exitCode ? "SOME TESTS FAILED" : "ALL PASSED");
