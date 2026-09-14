import { getSupabaseClient } from "./supabase";
import { insertOutboundEvent } from "./outboundRepository";
function db(){const c=getSupabaseClient();if(!c)throw new Error("Suppression storage unavailable");return c;}
export async function isOutboundPhoneSuppressed(businessId:string,phone:string){const r=await db().from("outbound_phone_suppressions").select("phone_number").eq("business_id",businessId).eq("phone_number",phone).maybeSingle();if(r.error)throw new Error("Unable to verify phone suppression");return Boolean(r.data);}
export async function suppressOutboundCaller(businessId:string,phone:string,callId:string){
 if(!/^\+[1-9]\d{7,14}$/.test(phone)||!callId)throw new Error("Verified caller number required");
 const r=await db().from("outbound_phone_suppressions").upsert({business_id:businessId,phone_number:phone,source:"signed_collection_callback",source_call_id:callId},{onConflict:"business_id,phone_number",ignoreDuplicates:true});if(r.error)throw new Error("Unable to record phone suppression");
 await insertOutboundEvent({business_id:businessId,event_type:"caller_number_suppressed",source:"retell_function",external_event_id:`caller_number_suppressed:${callId}`,payload:{phone_number:phone,identity_verified:false,scope:"calling_number_only"}});
 return {suppressed:true,scope:"calling_number_only",message_for_agent:"This calling number has been removed from our collection call list. Goodbye."};
}
