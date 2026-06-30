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

const toolHelp: Record<string, { name: string; method: string; description: string; example: Record<string, unknown> }> = {
  "create-lead": {
    name: "create_lead",
    method: "POST",
    description: "Save an inbound pest-control lead or booking request.",
    example: {
      caller_name: "Maria",
      caller_phone: "+17185550100",
      pest_issue: "ants in kitchen",
      urgency_level: "low",
      preferred_booking_method: "phone_booking",
      property_address: "25 Pine Street, Brooklyn, NY 11201",
      preferred_datetime: "tomorrow morning",
      call_summary: "Caller wants help with ants.",
    },
  },
  "send-booking-sms": {
    name: "send_booking_sms",
    method: "POST",
    description: "Send or simulate a booking SMS. This remains backend-only for inbound and is not attached to the inbound LLM.",
    example: {
      caller_name: "Maria",
      caller_phone: "+17185550100",
      pest_issue: "ants in kitchen",
    },
  },
  "check-service-area": {
    name: "check_service_area",
    method: "POST",
    description: "Validate a city, ZIP, or property address against configured service-area rules.",
    example: {
      property_address: "25 Pine Street, Brooklyn, NY 11201",
      city: "Brooklyn",
      state: "NY",
      zip_code: "11201",
    },
  },
  "transfer-call": {
    name: "log_transfer_request",
    method: "POST",
    description: "Log a transfer request before using Retell native transfer_call.",
    example: {
      reason: "Caller requested a live person",
      caller_phone: "+17185550100",
      pest_issue: "hornets",
      urgency_level: "high",
    },
  },
};

function getToolHelp(routeName: string) {
  return (_req: Parameters<Parameters<Router["get"]>[1]>[0], res: Parameters<Parameters<Router["get"]>[1]>[1]) => {
    const help = toolHelp[routeName];
    res.json({
      ok: true,
      tool: help.name,
      method_required: help.method,
      description: help.description,
      example_payload: help.example,
      note: "Use POST with application/json. This help response contains no secrets and does not execute the tool.",
    });
  };
}

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
toolsRouter.get("/create_lead", getToolHelp("create-lead"));
toolsRouter.post("/create-lead", createLeadHandler);
toolsRouter.get("/create-lead", getToolHelp("create-lead"));
toolsRouter.post("/send_booking_sms", sendBookingSmsHandler);
toolsRouter.get("/send_booking_sms", getToolHelp("send-booking-sms"));
toolsRouter.post("/send-booking-sms", sendBookingSmsHandler);
toolsRouter.get("/send-booking-sms", getToolHelp("send-booking-sms"));
toolsRouter.post("/check_service_area", checkServiceAreaHandler);
toolsRouter.get("/check_service_area", getToolHelp("check-service-area"));
toolsRouter.post("/check-service-area", checkServiceAreaHandler);
toolsRouter.get("/check-service-area", getToolHelp("check-service-area"));
toolsRouter.post("/transfer_call", transferCallHandler);
toolsRouter.get("/transfer_call", getToolHelp("transfer-call"));
toolsRouter.post("/transfer-call", transferCallHandler);
toolsRouter.get("/transfer-call", getToolHelp("transfer-call"));
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
