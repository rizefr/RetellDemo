import { beforeEach,describe,expect,it,vi } from "vitest";
import request from "supertest";
const mock=vi.hoisted(()=>({verify:vi.fn(),business:vi.fn(),suppress:vi.fn()}));
vi.mock("../services/outboundPhoneSuppression",()=>({suppressOutboundCaller:mock.suppress,isOutboundPhoneSuppressed:vi.fn().mockResolvedValue(false)}));
vi.mock("../services/outboundRetell",async()=>({...await vi.importActual<object>("../services/outboundRetell"),verifyOutboundRetellSignature:mock.verify}));
vi.mock("../services/outboundRepository",async()=>({...await vi.importActual<object>("../services/outboundRepository"),getOutboundBusinessSettings:mock.business}));
import { createApp } from "../app";
const business="00000000-0000-4000-8000-000000000001";
const payload=()=>({args:{explicit_opt_out:true},call:{call_id:"call-suppress-test",agent_id:"agent_5ca64503754e06c338e12c743f",from_number:"+12125550123",to_number:"+19842075346",metadata:{business_id:business,direction:"inbound_collections"}}});
beforeEach(()=>{vi.clearAllMocks();mock.verify.mockResolvedValue(true);mock.business.mockResolvedValue({id:business,inbound_retell_agent_id:"agent_5ca64503754e06c338e12c743f",callback_number:"+19842075346"});mock.suppress.mockResolvedValue({suppressed:true,scope:"calling_number_only"});});
const post=(body:object)=>request(createApp()).post("/api/outbound/retell/suppress-inbound-caller").set("x-retell-signature","signed-test").send(body);
describe("unverified collection caller suppression",()=>{
 it("suppresses only the signed calling number without identity data",async()=>{const r=await post(payload());expect(r.status).toBe(200);expect(mock.suppress).toHaveBeenCalledWith(business,"+12125550123","call-suppress-test");expect(r.body).not.toHaveProperty("invoice");});
 it("rejects an invalid signature",async()=>{mock.verify.mockResolvedValue(false);expect((await post(payload())).status).toBe(401);expect(mock.suppress).not.toHaveBeenCalled();});
 it("requires explicit opt-out rather than a polite goodbye",async()=>{const p=payload();p.args.explicit_opt_out=false;expect((await post(p)).status).toBe(422);expect(mock.suppress).not.toHaveBeenCalled();});
 it("rejects other agent and number bindings",async()=>{const p=payload();p.call.agent_id="inbound-pest-control";expect((await post(p)).status).toBe(403);p.call.agent_id="agent_5ca64503754e06c338e12c743f";p.call.to_number="+18887809963";expect((await post(p)).status).toBe(403);expect(mock.suppress).not.toHaveBeenCalled();});
});
