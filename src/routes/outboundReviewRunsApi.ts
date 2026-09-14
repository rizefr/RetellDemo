import express from 'express';
import {z} from 'zod';
import {requireOutboundAdmin,requireTrustedBrowserOrigin} from '../services/outboundAuth';
import {claimReviewRun,completeReviewRun,configureReviewRuns,getReviewRunStatus,ReviewRunError} from '../services/outboundReviewRuns';
export const outboundReviewRunsRouter=express.Router();
outboundReviewRunsRouter.use(requireOutboundAdmin);
outboundReviewRunsRouter.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method==='GET'||req.method==='HEAD'){next();return;}requireTrustedBrowserOrigin(req,res,next);});
const business=z.object({business_id:z.uuid()}).strict();
function fail(res:express.Response,error:unknown){if(error instanceof z.ZodError){res.status(400).json({error:'Invalid weekly review request'});return;}res.status(error instanceof ReviewRunError?error.status:500).json({error:error instanceof ReviewRunError?error.message:'Weekly review operation failed'});}
outboundReviewRunsRouter.get('/status',async(req,res)=>{try{res.json(await getReviewRunStatus(business.parse(req.query).business_id));}catch(error){fail(res,error);}});
outboundReviewRunsRouter.post('/config',async(req,res)=>{try{res.json(await configureReviewRuns(business.extend({stage:z.enum(['staged_preview','live_verified']),spreadsheet_url:z.string().url().max(250),enabled:z.boolean()}).strict().parse(req.body)));}catch(error){fail(res,error);}});
outboundReviewRunsRouter.post('/claim',async(req,res)=>{try{res.json(await claimReviewRun(business.parse(req.body).business_id));}catch(error){fail(res,error);}});
outboundReviewRunsRouter.post('/complete',async(req,res)=>{try{const input=business.extend({run_id:z.uuid(),claim_token:z.uuid(),outcome:z.enum(['accepted','uncertain','failed_no_send']),provider_message_id:z.string().trim().min(1).max(512).optional(),failure_code:z.string().regex(/^[a-z0-9_-]{1,100}$/).optional()}).strict().parse(req.body);res.json(await completeReviewRun(input));}catch(error){fail(res,error);}});
