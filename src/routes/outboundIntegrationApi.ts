import express from 'express';
import { z } from 'zod';
import { requireOutboundAdmin, requireTrustedBrowserOrigin } from '../services/outboundAuth';
import { applyQuickBooksPreview, getQuickBooksIntegrationStatus, getQuickBooksQueue, previewQuickBooksSync } from '../services/outboundQuickBooksIntegration';
import { quickBooksReportCsv, QuickBooksSyncError } from '../services/outboundQuickBooksSync';
export const outboundIntegrationApiRouter=express.Router();
outboundIntegrationApiRouter.use(requireOutboundAdmin);
outboundIntegrationApiRouter.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(['GET','HEAD'].includes(req.method)){next();return;}requireTrustedBrowserOrigin(req,res,next);});
const business=z.object({business_id:z.uuid()}).strict();
function fail(res:express.Response,error:unknown){if(error instanceof z.ZodError){res.status(400).json({error:'Invalid integration request'});return;}res.status(error instanceof QuickBooksSyncError?error.status:500).json({error:error instanceof QuickBooksSyncError?error.message:'Integration request failed',code:error instanceof QuickBooksSyncError?error.code:'integration_failed'});}
outboundIntegrationApiRouter.get('/quickbooks/status',async(req,res)=>{try{res.json(await getQuickBooksIntegrationStatus(business.parse(req.query).business_id));}catch(error){fail(res,error);}});
outboundIntegrationApiRouter.post('/quickbooks/preview',async(req,res)=>{try{res.json(await previewQuickBooksSync(business.parse(req.body).business_id));}catch(error){fail(res,error);}});
outboundIntegrationApiRouter.post('/quickbooks/apply',async(req,res)=>{try{const input=business.extend({preview_id:z.uuid(),preview_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);res.json(await applyQuickBooksPreview(input.business_id,input.preview_id,input.preview_hash));}catch(error){fail(res,error);}});
outboundIntegrationApiRouter.get('/quickbooks/queue',async(req,res)=>{try{res.json(await getQuickBooksQueue(business.parse(req.query).business_id));}catch(error){fail(res,error);}});
outboundIntegrationApiRouter.get('/quickbooks/report.csv',async(req,res)=>{try{const queue=await getQuickBooksQueue(business.parse(req.query).business_id);res.setHeader('Content-Disposition','attachment; filename="pinnacle-overdue-review.csv"');res.type('text/csv').send(quickBooksReportCsv(queue.invoices));}catch(error){fail(res,error);}});
