import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20261013170000_outbound_failed_login_budget.sql"), "utf8");
let db: PGlite;
const attempt = async () => (await db.query<{ result: { allowed: boolean; retry_after_seconds: number } }>("select public.outbound_record_admin_login_attempt() as result")).rows[0].result;

describe("durable login budget in isolated PostgreSQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(migration);
  }, 30000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("reset role; truncate public.outbound_admin_login_budget;"); });

  it("allows twenty attempts and denies subsequent attempts without unbounded growth", async () => {
    for (let i = 0; i < 20; i++) expect((await attempt()).allowed).toBe(true);
    for (let i = 0; i < 3; i++) {
      const result = await attempt();
      expect(result.allowed).toBe(false);
      expect(result.retry_after_seconds).toBeGreaterThanOrEqual(1);
      expect(result.retry_after_seconds).toBeLessThanOrEqual(60);
    }
    expect((await db.query("select scope, attempts from public.outbound_admin_login_budget")).rows).toEqual([{ scope: "outbound_admin", attempts: 21 }]);
  });

  it("resets the persisted window after sixty seconds", async () => {
    await attempt();
    await db.exec("update public.outbound_admin_login_budget set attempts=21, window_started_at=clock_timestamp()-interval '61 seconds';");
    expect(await attempt()).toMatchObject({ allowed: true, retry_after_seconds: 60 });
    expect((await db.query("select attempts from public.outbound_admin_login_budget")).rows).toEqual([{ attempts: 1 }]);
  });

  it("enables RLS and denies public API roles both table access and RPC execution", async () => {
    expect((await db.query("select relrowsecurity from pg_class where relname='outbound_admin_login_budget'")).rows).toEqual([{ relrowsecurity: true }]);
    expect((await db.query("select r, has_function_privilege(r,'public.outbound_record_admin_login_attempt()','execute') as allowed from unnest(array['anon','authenticated','service_role']) r")).rows).toEqual([{ r: "anon", allowed: false }, { r: "authenticated", allowed: false }, { r: "service_role", allowed: true }]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(attempt()).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select * from public.outbound_admin_login_budget")).rejects.toMatchObject({ code: "42501" });
      await db.exec("reset role");
    }
  });

  it("uses an invoker function with an empty search path", async () => {
    expect((await db.query("select prosecdef, proconfig from pg_proc where proname='outbound_record_admin_login_attempt'")).rows).toEqual([{ prosecdef: false, proconfig: ['search_path=""'] }]);
  });
});
