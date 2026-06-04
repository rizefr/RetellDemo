import { CheckServiceAreaInput } from "../schemas/toolSchemas";
import { elijahPestControlKnowledgeBase } from "../retell/knowledgeBase";

export type ServiceAreaStatus = "in_area" | "maybe" | "outside_area";

function configuredServiceArea(): string {
  const match = elijahPestControlKnowledgeBase.match(/^Service Area:\s*(.*)$/m);
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function tokenMatch(needle: string | null | undefined, haystack: string): boolean {
  if (!needle || !haystack) return false;
  return haystack.includes(needle.toLowerCase().trim());
}

function zipStatus(zip: string | null | undefined, serviceArea: string): ServiceAreaStatus | null {
  if (!zip || !serviceArea) return null;
  const digits = zip.replace(/\D/g, "").slice(0, 5);
  if (digits.length !== 5) return null;
  return tokenMatch(digits, serviceArea) ? "in_area" : "maybe";
}

export function checkServiceArea(input: CheckServiceAreaInput): {
  status: ServiceAreaStatus;
  message_for_agent: string;
} {
  const serviceArea = configuredServiceArea();
  if (!serviceArea) {
    return {
      status: "maybe",
      message_for_agent:
        "The knowledge base does not list a service area. Do not confirm coverage; capture the lead and say the team can confirm.",
    };
  }

  const byZip = zipStatus(input.zip_code, serviceArea);
  if (byZip === "in_area") {
    return {
      status: "in_area",
      message_for_agent: "The caller appears to match the service area listed in the knowledge base. Continue normally.",
    };
  }

  const city = input.city?.toLowerCase().trim();
  const state = input.state?.toLowerCase().trim();
  if (tokenMatch(city, serviceArea) || tokenMatch(state, serviceArea)) {
    return {
      status: "in_area",
      message_for_agent: "The caller appears to match the service area listed in the knowledge base. Continue normally.",
    };
  }

  return {
    status: "maybe",
    message_for_agent:
      "The caller's location is not clearly listed in the knowledge base. Continue capturing the lead and say the team can confirm coverage.",
  };
}
