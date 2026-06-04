import { Router } from "express";
import {
  bookAppointmentSchema,
  checkAvailabilitySchema,
  checkServiceAreaSchema,
  createLeadSchema,
  sendBookingSmsSchema,
  transferCallSchema,
} from "../schemas/toolSchemas";
import { createLead } from "../services/leads";
import { sendBookingSms } from "../services/sms";
import { checkServiceArea } from "../services/serviceArea";
import { storeTransferEvent } from "../services/callEvents";
import { getCalendarAdapter, getCandidateCalendarAdapter } from "../services/calendar";

export const toolsRouter = Router();

function argsFromBody(body: unknown): unknown {
  if (body && typeof body === "object" && "args" in body) {
    return (body as { args: unknown }).args;
  }
  return body;
}

function handler<T>(
  schema: { parse: (input: unknown) => T },
  fn: (input: T) => Promise<unknown> | unknown,
) {
  return async (req: Parameters<Parameters<Router["post"]>[1]>[0], res: Parameters<Parameters<Router["post"]>[1]>[1]) => {
    try {
      const input = schema.parse(argsFromBody(req.body));
      const result = await fn(input);
      res.json(result);
    } catch (error) {
      console.error("Tool request failed", { error });
      res.status(400).json({
        success: false,
        message_for_agent:
          "The backend could not process that request. Continue politely and offer transfer or follow-up.",
      });
    }
  };
}

const createLeadHandler = handler(createLeadSchema, createLead);
const sendBookingSmsHandler = handler(sendBookingSmsSchema, sendBookingSms);
const checkServiceAreaHandler = handler(checkServiceAreaSchema, checkServiceArea);
const transferCallHandler = handler(transferCallSchema, storeTransferEvent);
const checkAvailabilityHandler = handler(checkAvailabilitySchema, (input) => getCalendarAdapter().checkAvailability(input));
const bookAppointmentHandler = handler(bookAppointmentSchema, (input) => getCalendarAdapter().bookAppointment(input));
const candidateCheckAvailabilityHandler = handler(checkAvailabilitySchema, (input) =>
  getCandidateCalendarAdapter().checkAvailability(input),
);
const candidateBookAppointmentHandler = handler(bookAppointmentSchema, (input) =>
  getCandidateCalendarAdapter().bookAppointment(input),
);

toolsRouter.post("/create_lead", createLeadHandler);
toolsRouter.post("/create-lead", createLeadHandler);
toolsRouter.post("/send_booking_sms", sendBookingSmsHandler);
toolsRouter.post("/send-booking-sms", sendBookingSmsHandler);
toolsRouter.post("/check_service_area", checkServiceAreaHandler);
toolsRouter.post("/check-service-area", checkServiceAreaHandler);
toolsRouter.post("/transfer_call", transferCallHandler);
toolsRouter.post("/transfer-call", transferCallHandler);
toolsRouter.post(
  "/check_availability_cal",
  checkAvailabilityHandler,
);
toolsRouter.post("/check-availability-cal", checkAvailabilityHandler);
toolsRouter.post("/candidate/check-availability-cal", candidateCheckAvailabilityHandler);
toolsRouter.post(
  "/book_appointment_cal",
  bookAppointmentHandler,
);
toolsRouter.post("/book-appointment-cal", bookAppointmentHandler);
toolsRouter.post("/candidate/book-appointment-cal", candidateBookAppointmentHandler);
