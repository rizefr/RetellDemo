# Future Pest-Control Client Onboarding Checklist

Use this checklist before creating a client-specific Retell receptionist. This is for setup with the business owner, not for the voice agent to ask callers.

## Business Source Material

- Is the company website current and accurate?
- Which pages should be treated as reliable source material?
- Are there pages, prices, service areas, or policies that are outdated and should not be used?
- What questions do callers ask most often?
- What calls should always go to a live person?

## Knowledge Base Fields To Collect

- Business name, phone, email, website, and preferred receptionist name.
- Address, city, state, ZIP code, service area, and any out-of-area rules.
- Business hours, holiday handling, emergency hours, and after-hours process.
- Services offered and services not offered.
- Common pest issues and how the team wants the receptionist to describe them.
- Appointment types, appointment length, same-day availability, emergency service, free inspection policy, residential service, and commercial service.
- Pricing, inspection fees, plan pricing, one-time treatment pricing, and what should happen when pricing is unknown.
- Service details such as treatment duration, follow-up, warranty, guarantee, and result expectations.
- Approved safety language for pets, children, allergies, sensitive areas, and prep instructions.
- Customer preparation steps before and after treatment.
- Technician names, licenses, certifications, and years of experience if the business wants these mentioned.
- Accepted payment methods, deposit rules, payment timing, and financing.
- Cancellation, rescheduling, late arrival, warranty, and service guarantee policies.
- Transfer rules for urgent calls, complaints, billing, chemical/safety questions, medical concerns, and unsupported services.

## Booking And Follow-Up

- Confirm the booking URL that SMS should send.
- Confirm whether SMS is live or simulated.
- Confirm whether phone booking is disabled, mock-only, or connected to a real calendar/CRM.
- Confirm the transfer phone number.
- Confirm whether bilingual handling is live, transfer-only, or not supported.
- Confirm whether keypad/DTMF routing is needed.

## Launch Checklist

- Fill in the KB template in `src/retell/knowledgeBase.ts`.
- Update `.env` business name, booking URL, transfer number, Retell phone number, webhook URL, and tool base URL.
- Keep unknown fields blank; do not invent missing details.
- Run `npm run test`.
- Run endpoint curl tests for tools and webhook security.
- Run `npm run refine:retell` for an existing live agent, or `npm run setup:retell` for a new client build.
- Publish and verify the weighted phone binding.
- Run a live phone test for booking, pricing, urgent transfer, unsupported question, and closing behavior.
