import Retell from "retell-sdk";
import { env } from "../config/env";

export function getRetellClient(): Retell {
  if (!env.RETELL_API_KEY) {
    throw new Error("RETELL_API_KEY is required for Retell setup or API calls.");
  }
  return new Retell({ apiKey: env.RETELL_API_KEY });
}
