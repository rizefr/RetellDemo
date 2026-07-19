(() => {
  const page = document.querySelector("[data-landing-page]");
  if (!page) return;

  const variant = page.dataset.variant;
  const route = page.dataset.route;
  const landingRoutes = { answer: "/answer/", ready: "/ready/", coverage: "/coverage/" };
  if (!variant || landingRoutes[variant] !== route) return;

  const createUuid = () => {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const readSessionId = () => {
    try {
      const stored = sessionStorage.getItem("elixis_lp_session");
      if (/^[0-9a-f-]{36}$/i.test(stored || "")) return stored;
      const created = createUuid();
      sessionStorage.setItem("elixis_lp_session", created);
      return created;
    } catch {
      return createUuid();
    }
  };

  const query = new URLSearchParams(location.search);
  const trackingKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  const currentAttribution = Object.fromEntries(
    trackingKeys.map((key) => [key, (query.get(key) || "").trim().slice(0, 160)]),
  );
  const hasCurrentAttribution = trackingKeys.some((key) => currentAttribution[key]);
  let attribution = currentAttribution;
  try {
    if (hasCurrentAttribution) {
      sessionStorage.setItem("elixis_lp_attribution", JSON.stringify(currentAttribution));
    } else {
      const saved = JSON.parse(sessionStorage.getItem("elixis_lp_attribution") || "null");
      if (saved && typeof saved === "object") {
        attribution = Object.fromEntries(
          trackingKeys.map((key) => [key, typeof saved[key] === "string" ? saved[key].slice(0, 160) : ""]),
        );
      }
    }
  } catch {
    attribution = currentAttribution;
  }

  let referrerHost = "";
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname.slice(0, 253) : "";
  } catch {
    referrerHost = "";
  }

  const sessionId = readSessionId();
  const pageLoadId = createUuid();
  const isTest = query.get("test") === "1";
  const privacyLimited =
    navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1";

  const basePayload = () => ({
    variant,
    route,
    session_id: sessionId,
    page_load_id: pageLoadId,
    is_test: isTest,
    utm_source: attribution.utm_source || null,
    utm_medium: attribution.utm_medium || null,
    utm_campaign: attribution.utm_campaign || null,
    utm_content: attribution.utm_content || null,
    utm_term: attribution.utm_term || null,
    referrer_host: referrerHost || null,
  });

  const postEvent = async (eventName, metadata = {}, submissionId = null) => {
    if (privacyLimited) return;
    const response = await fetch("/api/landing/events", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Elixis-Form": "landing-v1" },
      body: JSON.stringify({
        ...basePayload(),
        event_name: eventName,
        submission_id: submissionId,
        metadata,
      }),
    });
    if (!response.ok) throw new Error(`event_${response.status}`);
  };

  postEvent("page_view").catch(() => {
    document.documentElement.dataset.landingAnalytics = "degraded";
  });

  const linkedAttribution = (href) => {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return href;
    url.searchParams.set("lp_variant", variant);
    trackingKeys.forEach((key) => {
      if (attribution[key]) url.searchParams.set(key, attribution[key]);
    });
    if (isTest) url.searchParams.set("test", "1");
    return `${url.pathname}${url.search}${url.hash}`;
  };

  document.querySelectorAll("a[data-track]").forEach((link) => {
    link.href = linkedAttribution(link.getAttribute("href") || "/");
    link.addEventListener("click", () => {
      const eventName = link.dataset.track;
      const target = eventName === "booking_click" ? "booking" : "demo";
      postEvent(eventName, { target }).catch(() => {});
    });
  });

  document.querySelectorAll("[data-scroll-form]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const formHeading = document.querySelector("#fit-check-heading");
      window.setTimeout(() => formHeading?.focus({ preventScroll: true }), 450);
    });
  });

  const mobileCta = document.querySelector(".mobile-cta");
  const heroActions = document.querySelector(".hero-actions");
  if (mobileCta && heroActions) {
    if ("IntersectionObserver" in window) {
      const mobileCtaObserver = new IntersectionObserver((entries) => {
        mobileCta.classList.toggle("is-visible", !entries[0]?.isIntersecting);
      });
      mobileCtaObserver.observe(heroActions);
    } else {
      mobileCta.classList.add("is-visible");
    }
  }

  const form = document.querySelector("[data-lead-form]");
  if (form) {
    const stepOne = form.querySelector('[data-form-step="1"]');
    const stepTwo = form.querySelector('[data-form-step="2"]');
    const nextButton = form.querySelector("[data-form-next]");
    const backButton = form.querySelector("[data-form-back]");
    const submitButton = form.querySelector('[type="submit"]');
    const submitLabel = submitButton?.querySelector("[data-submit-label]");
    const status = form.querySelector("[data-form-status]");
    const success = document.querySelector("[data-form-success]");
    const startedAt = new Date().toISOString();
    let formStarted = false;
    let submissionId = createUuid();

    const setStep = (step) => {
      const showOne = step === 1;
      stepOne.hidden = !showOne;
      stepTwo.hidden = showOne;
      form.dataset.currentStep = String(step);
      form.querySelectorAll("[data-step-indicator]").forEach((indicator) => {
        const active = Number(indicator.dataset.stepIndicator) === step;
        indicator.classList.toggle("active", active);
        if (active) indicator.setAttribute("aria-current", "step");
        else indicator.removeAttribute("aria-current");
      });
      const heading = form.querySelector(showOne ? "#fit-step-one" : "#fit-step-two");
      heading?.focus({ preventScroll: true });
    };

    const startForm = () => {
      if (formStarted) return;
      formStarted = true;
      postEvent("form_start", { target: "hero_form", step: 1 }).catch(() => {});
    };

    const validateStep = (step) => {
      const fields = [...step.querySelectorAll("input")].filter((field) => field.name !== "website");
      const invalid = fields.find((field) => !field.checkValidity());
      if (!invalid) return true;
      invalid.reportValidity();
      invalid.focus();
      return false;
    };

    form.addEventListener("input", startForm, { once: false });
    form.addEventListener("change", startForm, { once: false });

    nextButton?.addEventListener("click", () => {
      startForm();
      if (!validateStep(stepOne)) return;
      postEvent("form_step_complete", { target: "form_next", step: 1 }, submissionId).catch(() => {});
      setStep(2);
    });

    backButton?.addEventListener("click", () => setStep(1));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      startForm();
      if (!form.reportValidity()) return;

      submitButton.disabled = true;
      if (submitLabel) submitLabel.textContent = "Sending…";
      status.textContent = "Saving your request securely…";
      status.className = "form-status";

      const values = Object.fromEntries(new FormData(form).entries());
      const payload = {
        ...basePayload(),
        submission_id: submissionId,
        started_at: startedAt,
        website: String(values.website || ""),
        interest: String(values.interest || ""),
        current_handling: String(values.current_handling || ""),
        coverage_gap: String(values.coverage_gap || ""),
        call_volume_band: String(values.call_volume_band || ""),
        full_name: String(values.full_name || ""),
        business_name: String(values.business_name || ""),
        email: String(values.email || ""),
        phone: String(values.phone || ""),
      };

      postEvent("form_submit", { target: "form_submit", step: 2 }, submissionId).catch(() => {});

      try {
        const response = await fetch("/api/landing/leads", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-Elixis-Form": "landing-v1" },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(result.error || "We could not save the request");
          error.fields = result.fields || [];
          error.status = response.status;
          throw error;
        }

        form.hidden = true;
        success.hidden = false;
        const successHeading = success.querySelector("h3");
        successHeading?.focus({ preventScroll: true });
        success.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (error) {
        const fields = Array.isArray(error.fields) ? error.fields : [];
        if (fields.some((field) => ["interest", "current_handling", "coverage_gap", "call_volume_band"].includes(field))) {
          setStep(1);
        }
        const target = fields.length ? form.querySelector(`[name="${CSS.escape(fields[0])}"]`) : null;
        target?.focus();
        status.textContent = error.message || "We could not save the request. Please try again or use the booking link.";
        status.className = "form-status error";
        const errorCode = error.status >= 500 ? "server" : error.status ? "validation" : "network";
        postEvent("form_error", { target: "form_retry", step: 2, error_code: errorCode }, submissionId).catch(() => {});
        if (error.status === 409) submissionId = createUuid();
      } finally {
        submitButton.disabled = false;
        if (submitLabel) submitLabel.textContent = "Request my demo plan";
      }
    });
  }

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveals = document.querySelectorAll("[data-reveal]");
  if (reducedMotion || !("IntersectionObserver" in window)) {
    reveals.forEach((item) => item.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8%", threshold: 0.12 },
    );
    reveals.forEach((item) => observer.observe(item));
  }
})();
