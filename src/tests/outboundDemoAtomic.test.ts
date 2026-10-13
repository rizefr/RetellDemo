import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Explicit local-only engine: never use a project/production database URL.
// DEMO_TEST_PGLITE_MODULE=/tmp/pinnacle-demo-sql-test/node_modules/@electric-sql/pglite/dist/index.js
const enginePath = process.env.DEMO_TEST_PGLITE_MODULE || createRequire(path.resolve(process.cwd(), "package.json")).resolve("@electric-sql/pglite");
const business = "00000000-0000-4000-8000-000000000001";
const customer = "00000000-0000-4000-8000-000000000002";
const invoice = "00000000-0000-4000-8000-000000000003";
let db: any;
const migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261013203000_outbound_demo_source_columns.sql"), "utf8");
const save = (patches: Record<string, unknown>[] = [{business_name: "Changed"}, {first_name: "Changed"}, {invoice_date: "2026-04-07"}], ids = [business, customer, invoice]) => db.query("select public.outbound_update_demo_details($1,$2,$3,$4,$5,$6) as saved", [...ids, ...patches.map(p => JSON.stringify(p))]);
const state = async () => (await db.query(`select
 (select to_jsonb(b) from outbound_businesses b) as business,
 (select to_jsonb(c) from outbound_customers c) as customer,
 (select to_jsonb(i) from outbound_invoices i) as invoice`)).rows[0];

describe("atomic demo RPC in isolated PostgreSQL engine", () => {
  beforeAll(async () => {
    const {PGlite} = await import(enginePath!);
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table outbound_businesses(id uuid primary key, is_demo boolean not null, business_name text not null check(length(trim(business_name))>0), payment_mailing_instructions text);
      create table outbound_customers(id uuid primary key, business_id uuid references outbound_businesses(id), first_name text, last_name text, account_company_name text, phone_number text check(phone_number ~ '^\\+[1-9][0-9]{7,14}$'), email text, preferred_email text, preferred_phone_number text, payment_contact_preference text);
      create table outbound_invoices(id uuid primary key, business_id uuid references outbound_businesses(id), customer_id uuid references outbound_customers(id), source_provider text, source_realm_id text, provider_invoice_id text, provider_customer_id text, status text, invoice_id text, amount_due_cents integer check(amount_due_cents>0), inspection_date date, invoice_date date, original_due_date date, service_description text, inspection_type text, expected_payment_date date, demo_call_mode text, previous_call_date date, followup_reason text, prior_concern_note text, preferred_payment_method text, callback_details text);
      alter table outbound_businesses enable row level security;
      alter table outbound_customers enable row level security;
      alter table outbound_invoices enable row level security;
    `);
    await db.exec(migration);
  }, 30000);
  afterAll(async () => {await db?.close();});
  beforeEach(async () => {
    await db.exec(`drop trigger if exists demo_race on outbound_businesses;
      truncate outbound_invoices,outbound_customers,outbound_businesses;
      insert into outbound_businesses values ('${business}',true,'Original',null);
      insert into outbound_customers(id,business_id,first_name,phone_number) values('${customer}','${business}','Original','+15555550100');
      insert into outbound_invoices(id,business_id,customer_id,source_provider,status,invoice_id,amount_due_cents,original_due_date) values('${invoice}','${business}','${customer}','local','unpaid','DEMO',5000,'2026-05-07');`);
  });
  it("saves all three records and separate dates without touching payment state", async () => {
    const result = await save([{business_name:"Changed"},{first_name:"Changed"},{inspection_date:"2026-04-01",invoice_date:"2026-04-07"}]);
    expect(result.rows[0].saved).toMatchObject({business:{business_name:"Changed"},customer:{first_name:"Changed"},invoice:{status:"unpaid",inspection_date:"2026-04-01",invoice_date:"2026-04-07",original_due_date:"2026-05-07"}});
  });
  it("rolls back earlier business and customer writes when the invoice update fails", async () => {
    const before = await state();
    await expect(save([{business_name:"Changed"},{first_name:"Changed"},{amount_due_cents:-1}])).rejects.toMatchObject({code:"23514"});
    expect(await state()).toEqual(before);
  });
  it("rejects a paid row changed since the editor loaded, before any save", async () => {
    await db.exec(`update outbound_invoices set status='paid' where id='${invoice}'`);
    const before = await state();
    await expect(save()).rejects.toMatchObject({code:"PT409"});
    expect(await state()).toEqual(before);
  });
  it("rolls back all demo edits if payment status changes inside the save", async () => {
    // A trigger forces the otherwise row-lock-excluded interleaving, exercising
    // the final guarded UPDATE and rollback after earlier writes really ran.
    await db.exec(`create or replace function demo_race() returns trigger language plpgsql as $$ begin update public.outbound_invoices set status='paid' where id='${invoice}'; return new; end $$;
      create trigger demo_race after update on outbound_businesses for each row execute function demo_race();`);
    const before = await state();
    await expect(save()).rejects.toMatchObject({code:"PT409"});
    expect(await state()).toEqual(before);
  });
  it.each(["source_provider='quickbooks'","source_provider='unverified'","source_realm_id='9130357319687676'","provider_invoice_id='81'","provider_customer_id='1'"])("rejects protected source %s", async change => {
    await db.exec(`update outbound_invoices set ${change}`);
    const before = await state();
    await expect(save()).rejects.toMatchObject({code:"PT409"});
    expect(await state()).toEqual(before);
  });
  it("rejects cross-business IDs and a live business with no writes", async () => {
    const before = await state();
    await expect(save(undefined,["00000000-0000-4000-8000-000000000099",customer,invoice])).rejects.toMatchObject({code:"PT403"});
    expect(await state()).toEqual(before);
    await db.exec("update outbound_businesses set is_demo=false");
    const live = await state();
    await expect(save()).rejects.toMatchObject({code:"PT409"});
    expect(await state()).toEqual(live);
  });
  it.each([[{is_demo:true},{},{}],[{},{business_id:business},{}],[{},{},{status:"unpaid"}],[{},{},{source_provider:"local"}]])("rejects non-whitelisted fields %j", async (b,c,i) => {
    const before = await state();
    await expect(save([b,c,i])).rejects.toMatchObject({code:"PT400"});
    expect(await state()).toEqual(before);
  });
  it("keeps RLS and grants execution only to the service role", async () => {
    const privileges = await db.query("select r, has_function_privilege(r,'public.outbound_update_demo_details(uuid,uuid,uuid,jsonb,jsonb,jsonb)','execute') as allowed from unnest(array['anon','authenticated','service_role']) r");
    expect(privileges.rows).toEqual([{r:"anon",allowed:false},{r:"authenticated",allowed:false},{r:"service_role",allowed:true}]);
    expect((await db.query("select relrowsecurity from pg_class where relname in ('outbound_businesses','outbound_customers','outbound_invoices')")).rows.every((r:any)=>r.relrowsecurity)).toBe(true);
  });
});
