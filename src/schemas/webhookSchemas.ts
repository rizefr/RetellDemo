import { z } from "zod";

export const retellWebhookSchema = z
  .object({
    event: z.string().optional(),
    call: z.record(z.string(), z.unknown()).optional(),
    chat: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type RetellWebhookPayload = z.infer<typeof retellWebhookSchema>;
