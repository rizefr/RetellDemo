import express from 'express';
import {z} from 'zod';
import {requireOutboundAdmin,requireTrustedBrowserOrigin} from '../services/outboundAuth';
import {claimReviewJob,completeReviewJob,getReviewJobStatus,reconcileReviewJob,REVIEW_RECONCILIATION_CONFIRMATION,ReviewJobError} from '../services/outboundReviewJobs';
export const outboundReviewJobsRouter=express.Router();
outboundReviewJobsRouter.use(requireOutboundAdmin);
outboundReviewJobsRouter.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(['GET','HEAD'].includes(req.method)){next();return;}requireTrustedBrowserOrigin(req,res,next);});
const business=z.object({business_id:z.uuid()}).strict();
const count=z.number().int().nonnegative().max(10000);
const readback=z.object({spreadsheet_url:z.string().regex(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/edit)?$/).max(250),source_run_id:z.uuid(),source_count:count,invoice_count:count,totals_minor_by_currency:z.record(z.string().regex(/^[A-Z]{3}$/),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))}).strict();
const completion=business.extend({job_id:z.uuid(),claim_token:z.uuid(),outcome:z.enum(['completed','failed']),source_run_id:z.uuid().optional(),readback:readback.optional(),failure_code:z.string().regex(/^[a-z0-9_-]{1,100}$/).optional()}).strict();
function fail(res:express.Response,error:unknown){if(error instanceof z.ZodError){res.status(400).json({error:'Invalid review job request'});return;}res.status(error instanceof ReviewJobError?error.status:500).json({error:error instanceof ReviewJobError?error.message:'Review job operation failed'});}
outboundReviewJobsRouter.get('/status',async(req,res)=>{try{res.json(await getReviewJobStatus(business.parse(req.query).business_id));}catch(error){fail(res,error);}});
outboundReviewJobsRouter.post('/claim',async(req,res)=>{try{res.json(await claimReviewJob(business.parse(req.body).business_id));}catch(error){fail(res,error);}});
outboundReviewJobsRouter.post('/complete',async(req,res)=>{try{res.json(await completeReviewJob(completion.parse(req.body)));}catch(error){fail(res,error);}});
// Only an operator may attest provider work has ended. The scheduled worker must
// stop at a reconciliation hold and must never call this route automatically.
outboundReviewJobsRouter.post('/reconcile',async(req,res)=>{try{res.json(await reconcileReviewJob(business.extend({job_id:z.uuid(),confirmation:z.literal(REVIEW_RECONCILIATION_CONFIRMATION)}).strict().parse(req.body)));}catch(error){fail(res,error);}});
