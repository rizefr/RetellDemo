import { afterEach, beforeEach, expect, it, vi } from "vitest";
import request from "supertest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: true }));
vi.mock("../services/supabase", () => ({ getSupabaseClient: () => mocks.client ? { rpc: mocks.rpc } : null }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.client = true;
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("OUTBOUND_ADMIN_TOKEN", "login-budget-fixture");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("shares one durable budget between backend and outbound login before token comparison", async () => {
  mocks.rpc.mockResolvedValueOnce({data:{allowed:true,retry_after_seconds:60},error:null})
    .mockResolvedValueOnce({data:{allowed:false,retry_after_seconds:51},error:null});
  const { createApp }=await import("../app"); const app=createApp();
  const wrong=await request(app).post("/api/backend/auth/login").send({token:"wrong"});
  expect(wrong.status).toBe(401);
  const correctButLimited=await request(app).post("/api/outbound/auth/login").send({token:"login-budget-fixture"});
  expect(correctButLimited.status).toBe(429);expect(correctButLimited.headers["retry-after"]).toBe("51");
  expect(correctButLimited.headers["set-cookie"]).toBeUndefined();
  expect(mocks.rpc.mock.calls).toEqual([["outbound_record_admin_login_attempt"],["outbound_record_admin_login_attempt"]]);
});

it("fails closed on unavailable or malformed production storage and never leaks a token", async () => {
  vi.stubEnv("VERCEL_ENV","production");mocks.client=false;
  const { createApp }=await import("../app");
  const res=await request(createApp()).post("/api/outbound/auth/login").send({token:"login-budget-fixture"});
  expect(res.status).toBe(503);expect(res.headers["set-cookie"]).toBeUndefined();expect(res.text).not.toContain("login-budget-fixture");
});

it("uses a bounded local-only budget without database credentials outside production", async () => {
  mocks.client=false;vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-13T16:00:00Z"));
  const {outboundLoginBudget}=await import("../services/outboundLoginBudget");
  for(let i=0;i<20;i++)expect((await outboundLoginBudget()).allowed).toBe(true);
  expect((await outboundLoginBudget()).allowed).toBe(false);
  vi.advanceTimersByTime(60_000);expect((await outboundLoginBudget()).allowed).toBe(true);
});

it.each([{error:{message:"private database details"},data:null},{error:null,data:{allowed:true,retry_after_seconds:0}}])("rejects invalid RPC evidence", async result => {
  mocks.rpc.mockResolvedValue(result);
  const {outboundLoginBudget}=await import("../services/outboundLoginBudget");
  await expect(outboundLoginBudget()).rejects.toThrow("Login protection unavailable");
});
