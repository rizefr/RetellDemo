import express from "express";
import { z } from "zod";
import { requireOutboundAdmin, requireTrustedBrowserOrigin } from "../services/outboundAuth";
import { createOutboundEmailTemplate, emailTemplateContentSchema, listOutboundEmailTemplates, previewOutboundEmail, publishOutboundEmailTemplate } from "../services/outboundEmailTemplates";
import { sendOutboundPaymentEmailForInvoice } from "../services/outboundEmail";
import { getOutboundInvoiceContext } from "../services/outboundRepository";

export const outboundEmailApiRouter=express.Router();
outboundEmailApiRouter.use(requireOutboundAdmin);
outboundEmailApiRouter.use((req,res,next)=>["GET","HEAD","OPTIONS"].includes(req.method)?next():requireTrustedBrowserOrigin(req,res,next));
const business=z.object({business_id:z.uuid()});
const fail=(res:express.Response,error:unknown)=>res.status(error instanceof z.ZodError?422:400).json({error:error instanceof z.ZodError?"Invalid template request":"Email request could not be completed. Check the selected business, invoice, and connection."});

outboundEmailApiRouter.get("/templates",async(req,res)=>{try{
  const input=business.parse(req.query);res.json(await listOutboundEmailTemplates(input.business_id));
}catch(e){fail(res,e);}});
outboundEmailApiRouter.post("/templates",async(req,res)=>{try{
  const input=business.extend({content:emailTemplateContentSchema}).strict().parse(req.body);
  res.status(201).json({template:await createOutboundEmailTemplate(input.business_id,input.content)});
}catch(e){fail(res,e);}});
outboundEmailApiRouter.post("/templates/:id/publish",async(req,res)=>{try{
  const input=business.extend({make_default:z.boolean().default(false)}).strict().parse(req.body);
  res.json({template:await publishOutboundEmailTemplate(input.business_id,z.uuid().parse(req.params.id),input.make_default)});
}catch(e){fail(res,e);}});
outboundEmailApiRouter.get("/preview",async(req,res)=>{try{
  const input=business.extend({invoice_id:z.uuid(),template_id:z.uuid().optional()}).parse(req.query);
  res.setHeader("Cache-Control","no-store");
  res.json(await previewOutboundEmail(input.business_id,input.invoice_id,input.template_id));
}catch(e){fail(res,e);}});
outboundEmailApiRouter.post("/controlled-test",async(req,res)=>{try{
  const input=business.extend({invoice_id:z.uuid(),confirmed_email:z.email(),recipient_confirmed:z.literal(true),confirmation:z.literal("SEND ONE CONTROLLED DEMO EMAIL")}).strict().parse(req.body);
  if(input.confirmed_email.toLowerCase()!=="elixisagency@gmail.com") throw new Error("Controlled proof is restricted to the verified test recipient");
  const context=await getOutboundInvoiceContext(input.invoice_id);
  if(String(context.invoice.business_id)!==input.business_id) throw new Error("Invoice business mismatch");
  res.json(await sendOutboundPaymentEmailForInvoice(input.invoice_id,{confirmedEmail:input.confirmed_email,recipientConfirmed:true,requestKey:"controlled-pinnacle-demo-20260914",adminTest:true}));
}catch(e){fail(res,e);}});
