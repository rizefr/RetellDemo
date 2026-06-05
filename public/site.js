const menuButton = document.querySelector("[data-menu-button]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const retellModal = document.querySelector("[data-retell-modal]");
const retellOpeners = document.querySelectorAll("[data-open-retell]");
const retellClosers = document.querySelectorAll("[data-close-retell]");
const transcriptCarousel = document.querySelector("[data-transcript-carousel]");
const transcriptStack = document.querySelector("[data-transcript-stack]");
const transcriptLabel = document.querySelector("[data-transcript-label]");
const transcriptDots = document.querySelectorAll("[data-scenario-index]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const defaultConfig = {
  BRAND_NAME: "Elixis Agency",
  AI_DEMO_ORB_URL: "https://agent.retellai.com/orb/agent_1e77470887528d657c5ad62d4d?token=fea74a2da1190eb438f8613388427a68",
  AI_DEMO_PHONE: "tel:+19842075346",
  CONTACT_PHONE: "tel:+18603851624",
  BOOKING_URL: "https://cal.com/elixisagency/15min",
  CAL_PUBLIC_BOOKING_URL: "https://cal.com/retell-demo-eli1/actualmeetingletsgoooo",
  CAL_EVENT_TYPE_ID: "5875232",
};

const siteConfig = {
  ...defaultConfig,
  ...(window.ELIXIS_SITE_CONFIG || {}),
};

const transcriptScenarios = [
  {
    label: "Ants / normal lead",
    messages: [
      { speaker: "Caller", tone: "caller", text: "I’ve got ants all over the kitchen." },
      { speaker: "AI", tone: "ai", text: "Got it — I’ll save the request so the team can follow up with a booking link." },
      { speaker: "Caller", tone: "caller", text: "Can they come this week?" },
      { speaker: "AI", tone: "ai", text: "I’ll capture that preference so the team can confirm a time." },
    ],
  },
  {
    label: "Pricing / no fake quote",
    messages: [
      { speaker: "Caller", tone: "caller", text: "How much is roach treatment?" },
      { speaker: "AI", tone: "ai", text: "Pricing depends on the property and severity, so I won’t guess." },
      { speaker: "Caller", tone: "caller", text: "Can someone still reach out?" },
      { speaker: "AI", tone: "ai", text: "Yes — I’ll capture the request so the team can follow up." },
    ],
  },
  {
    label: "Urgent / transfer",
    messages: [
      { speaker: "Caller", tone: "caller urgent", text: "There’s a hornet nest by my front door." },
      { speaker: "AI", tone: "ai urgent", text: "That sounds urgent. I’ll get you connected with someone." },
      { speaker: "Caller", tone: "caller urgent", text: "My kid almost got stung." },
      { speaker: "AI", tone: "ai urgent", text: "Understood — I’m routing this as urgent now." },
    ],
  },
];

let transcriptScenarioIndex = 0;
let transcriptTimers = [];
let transcriptRunId = 0;

function clearTranscriptTimers() {
  transcriptTimers.forEach((timer) => window.clearTimeout(timer));
  transcriptTimers = [];
}

function createTranscriptMessage(message) {
  const item = document.createElement("p");
  item.className = `transcript-bubble ${message.tone}`;
  item.innerHTML = `<strong>${message.speaker}</strong> “${message.text}”`;
  return item;
}

function setTranscriptDots(index) {
  transcriptDots.forEach((dot) => {
    const isActive = Number(dot.getAttribute("data-scenario-index")) === index;
    dot.classList.toggle("is-active", isActive);
    dot.setAttribute("aria-selected", String(isActive));
  });
}

function showTranscriptScenario(index, shouldAutoAdvance = true) {
  if (!transcriptCarousel || !transcriptStack) return;

  clearTranscriptTimers();
  transcriptRunId += 1;
  const currentRunId = transcriptRunId;
  transcriptScenarioIndex = (index + transcriptScenarios.length) % transcriptScenarios.length;
  const scenario = transcriptScenarios[transcriptScenarioIndex];
  transcriptStack.innerHTML = "";
  if (transcriptLabel) transcriptLabel.textContent = scenario.label;
  setTranscriptDots(transcriptScenarioIndex);

  const messages = scenario.messages.map(createTranscriptMessage);
  messages.forEach((message) => transcriptStack.appendChild(message));

  if (reducedMotion.matches) {
    messages.forEach((message) => message.classList.add("is-visible"));
    return;
  }

  messages.forEach((message, messageIndex) => {
    const revealDelay = 420 + messageIndex * 980;
    transcriptTimers.push(window.setTimeout(() => {
      if (currentRunId !== transcriptRunId) return;
      message.classList.add("is-visible");
    }, revealDelay));
  });

  if (shouldAutoAdvance) {
    transcriptTimers.push(window.setTimeout(() => {
      if (currentRunId !== transcriptRunId) return;
      showTranscriptScenario(transcriptScenarioIndex + 1, true);
    }, 9500));
  }
}

function isValidOrbUrl(value) {
  try {
    const url = new URL(value);
    return url.href.startsWith("https://agent.retellai.com/orb/");
  } catch {
    return false;
  }
}

function getConfiguredOrbUrl() {
  const params = new URLSearchParams(window.location.search);
  const override = params.get("demoOrbUrl");
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  if (override && isLocalHost && isValidOrbUrl(override)) return override;
  if (isValidOrbUrl(siteConfig.AI_DEMO_ORB_URL)) return siteConfig.AI_DEMO_ORB_URL;
  return defaultConfig.AI_DEMO_ORB_URL;
}

function normalizePhoneHref(value) {
  if (!value) return defaultConfig.AI_DEMO_PHONE;
  return value.startsWith("tel:") ? value : `tel:${value}`;
}

function toCalLink(value) {
  if (!value) return "retell-demo-eli1/actualmeetingletsgoooo";

  try {
    const url = new URL(value);
    if (url.hostname.endsWith("cal.com")) {
      return url.pathname.replace(/^\/+/, "");
    }
  } catch {
    return value.replace(/^https:\/\/(?:app\.)?cal\.com\//, "").replace(/^\/+/, "");
  }

  return value;
}

function applySiteConfig() {
  const values = {
    ...siteConfig,
    AI_DEMO_ORB_URL: getConfiguredOrbUrl(),
    AI_DEMO_PHONE: normalizePhoneHref(siteConfig.AI_DEMO_PHONE),
    CONTACT_PHONE: normalizePhoneHref(siteConfig.CONTACT_PHONE || defaultConfig.CONTACT_PHONE),
    BOOKING_URL: siteConfig.BOOKING_URL || defaultConfig.BOOKING_URL,
  };

  document.querySelectorAll("[data-config-href]").forEach((node) => {
    const key = node.getAttribute("data-config-href");
    if (key && values[key]) node.setAttribute("href", values[key]);
  });

  document.querySelectorAll("[data-config-src]").forEach((node) => {
    const key = node.getAttribute("data-config-src");
    if (key && values[key]) node.setAttribute("src", values[key]);
  });

  const calTarget = document.querySelector("#cal-inline");
  if (calTarget) {
    calTarget.setAttribute("data-cal-link", toCalLink(values.CAL_PUBLIC_BOOKING_URL));
  }
}

function scrollToSection(id, behavior = "smooth") {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior, block: "start" });
}

function correctHashScroll() {
  const id = window.location.hash?.slice(1);
  if (!id) return;
  window.setTimeout(() => scrollToSection(id, "auto"), 120);
  window.setTimeout(() => scrollToSection(id, "auto"), 800);
  window.setTimeout(() => scrollToSection(id, "auto"), 1800);
}

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  mobileMenu?.classList.toggle("hidden", isOpen);
});

document.querySelectorAll("[data-mobile-menu] a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    mobileMenu?.classList.add("hidden");
  });
});

document.querySelectorAll("[data-scroll-target]").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    const id = trigger.getAttribute("data-scroll-target");
    if (!id) return;
    event.preventDefault();
    scrollToSection(id);
  });
});

transcriptDots.forEach((dot) => {
  dot.addEventListener("click", () => {
    const nextIndex = Number(dot.getAttribute("data-scenario-index"));
    if (Number.isNaN(nextIndex)) return;
    showTranscriptScenario(nextIndex, true);
  });
});

reducedMotion.addEventListener?.("change", () => {
  showTranscriptScenario(transcriptScenarioIndex, !reducedMotion.matches);
});

function openRetellModal() {
  retellModal?.classList.add("is-open");
  retellModal?.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeRetellModal() {
  retellModal?.classList.remove("is-open");
  retellModal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

retellOpeners.forEach((button) => button.addEventListener("click", openRetellModal));
retellClosers.forEach((button) => button.addEventListener("click", closeRetellModal));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeRetellModal();
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll(".reveal").forEach((section) => revealObserver.observe(section));

applySiteConfig();
showTranscriptScenario(0, !reducedMotion.matches);

function loadCalEmbed() {
  const target = document.querySelector("#cal-inline");
  const calLink = target?.getAttribute("data-cal-link");
  if (!target || !calLink) return;

  (function initCalEmbed(C, A, L) {
    const queue = function queue(api, args) {
      api.q.push(args);
    };
    const doc = C.document;
    C.Cal =
      C.Cal ||
      function calEmbed() {
        const cal = C.Cal;
        const args = arguments;
        if (!cal.loaded) {
          cal.ns = {};
          cal.q = cal.q || [];
          const script = doc.createElement("script");
          script.src = A;
          script.async = true;
          doc.head.appendChild(script);
          cal.loaded = true;
        }
        if (args[0] === L) {
          const api = function namespaceApi() {
            queue(api, arguments);
          };
          const namespace = args[1];
          api.q = api.q || [];
          if (typeof namespace === "string") {
            cal.ns[namespace] = cal.ns[namespace] || api;
            queue(cal.ns[namespace], args);
            queue(cal, ["initNamespace", namespace]);
          } else {
            queue(cal, args);
          }
          return;
        }
        queue(cal, args);
      };
  })(window, "https://app.cal.com/embed/embed.js", "init");

  window.Cal("init", "elixisBooking", { origin: "https://app.cal.com" });
  window.Cal.ns.elixisBooking("inline", {
    elementOrSelector: "#cal-inline",
    calLink,
    config: {
      layout: "month_view",
      theme: "dark",
    },
  });

  correctHashScroll();
}

loadCalEmbed();
window.addEventListener("load", correctHashScroll);
window.addEventListener("hashchange", correctHashScroll);
window.addEventListener("resize", correctHashScroll);
