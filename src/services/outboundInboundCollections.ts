export type InboundCollectionsCandidate = {
  customerId: string;
  invoiceId: string;
  firstName: string;
  lastName: string;
  accountCompanyName: string;
  phoneNumber: string;
  email: string;
  preferredEmail: string;
  externalInvoiceId: string;
};

export type InboundCollectionsLookupInput = {
  firstName: string;
  lastName?: string;
  callingPhoneNumber: string;
  accountCompanyName?: string;
  email?: string;
  invoiceId?: string;
};

export type InboundCollectionsMatch =
  | { status: "verified"; candidate: InboundCollectionsCandidate }
  | { status: "needs_verification" | "ambiguous" | "not_found" };

function normalized(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9@.+_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizedPhone(value: unknown): string {
  const raw = String(value ?? "").trim();
  return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : "";
}

export function chooseInboundCollectionsMatch(
  candidates: InboundCollectionsCandidate[],
  input: InboundCollectionsLookupInput,
): InboundCollectionsMatch {
  const firstName = normalized(input.firstName);
  const lastName = normalized(input.lastName);
  if (!firstName) return { status: "not_found" };

  const named = candidates.filter((candidate) => {
    if (normalized(candidate.firstName) !== firstName) return false;
    return !lastName || normalized(candidate.lastName) === lastName;
  });
  if (!named.length) return { status: "not_found" };

  const callingPhone = normalizedPhone(input.callingPhoneNumber);
  const email = normalized(input.email);
  const invoiceId = normalized(input.invoiceId);
  const accountCompanyName = normalized(input.accountCompanyName);
  const verified = named.filter((candidate) => {
    const phoneMatches = Boolean(callingPhone && normalizedPhone(candidate.phoneNumber) === callingPhone);
    const emailMatches = Boolean(
      email && [candidate.email, candidate.preferredEmail].some((value) => normalized(value) === email),
    );
    const invoiceMatches = Boolean(invoiceId && normalized(candidate.externalInvoiceId) === invoiceId);
    const companyMatches = Boolean(
      accountCompanyName && normalized(candidate.accountCompanyName) === accountCompanyName,
    );
    return phoneMatches || emailMatches || invoiceMatches || companyMatches;
  });

  if (verified.length === 1) return { status: "verified", candidate: verified[0] };
  if (verified.length > 1) return { status: "ambiguous" };
  return named.length > 1 ? { status: "ambiguous" } : { status: "needs_verification" };
}
