const menuButton = document.querySelector("[data-menu-button]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const serviceMenus = document.querySelectorAll(".services-menu");
const retellModal = document.querySelector("[data-retell-modal]");
const retellOpeners = document.querySelectorAll("[data-open-retell]");
const retellClosers = document.querySelectorAll("[data-close-retell]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const defaultConfig = {
  BRAND_NAME: "Elixis Agency",
  AI_DEMO_ORB_URL: "",
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
  return "";
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
    if (!key || !values[key]) return;
    if (node.closest("[data-retell-modal]")) {
      node.setAttribute("data-src", values[key]);
      node.removeAttribute("src");
      return;
    }
    node.setAttribute("src", values[key]);
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
  window.requestAnimationFrame(() => scrollToSection(id, "auto"));
  window.setTimeout(() => scrollToSection(id, "auto"), 700);
}

const callLineNode = document.querySelector("[data-call-line]");
const defaultCallLines = [
  "“Hi — this is a quick courtesy call about invoice 1048: $2,840, due June 18.”",
  "“I can send a secure payment link to the email on file — we never take card details by phone.”",
  "“I’ve logged your question for the team — someone will follow up today.”",
];
let callLineIndex = 0;

if (callLineNode && !reducedMotion.matches) {
  const linesAttr = callLineNode.getAttribute("data-call-lines") || "";
  const callLines = linesAttr
    ? linesAttr.split("|").map((line) => line.trim()).filter(Boolean)
    : defaultCallLines;

  if (callLines.length > 1) {
    window.setInterval(() => {
      callLineIndex = (callLineIndex + 1) % callLines.length;
      callLineNode.classList.add("is-swapping");
      window.setTimeout(() => {
        callLineNode.textContent = callLines[callLineIndex];
        callLineNode.classList.remove("is-swapping");
      }, 280);
    }, 5400);
  }
}

const siteHeader = document.querySelector(".site-header");
let headerScrollScheduled = false;

function updateHeaderScrollState() {
  headerScrollScheduled = false;
  siteHeader?.classList.toggle("is-scrolled", window.scrollY > 12);
}

if (siteHeader) {
  window.addEventListener(
    "scroll",
    () => {
      if (headerScrollScheduled) return;
      headerScrollScheduled = true;
      window.requestAnimationFrame(updateHeaderScrollState);
    },
    { passive: true },
  );
  updateHeaderScrollState();
}

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  mobileMenu?.classList.toggle("hidden", isOpen);
});

serviceMenus.forEach((menu) => {
  menu.addEventListener("toggle", () => {
    if (!menu.open) return;
    serviceMenus.forEach((otherMenu) => {
      if (otherMenu !== menu) otherMenu.open = false;
    });
  });
});

document.addEventListener("click", (event) => {
  serviceMenus.forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});

document.querySelectorAll("[data-mobile-menu] a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    mobileMenu?.classList.add("hidden");
    serviceMenus.forEach((menu) => {
      menu.open = false;
    });
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

let retellModalOpener = null;

function loadRetellEmbed() {
  const frame = retellModal?.querySelector("[data-retell-embed]");
  const source = frame?.getAttribute("data-src");
  if (frame && source && !frame.getAttribute("src")) frame.setAttribute("src", source);
}

function openRetellModal(event) {
  if (!retellModal) return;
  retellModalOpener = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  loadRetellEmbed();
  retellModal.classList.add("is-open");
  retellModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  window.requestAnimationFrame(() => retellModal.querySelector(".modal-close")?.focus());
}

function closeRetellModal() {
  if (!retellModal?.classList.contains("is-open")) return;
  retellModal.classList.remove("is-open");
  retellModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  retellModalOpener?.focus?.();
}

retellOpeners.forEach((button) => button.addEventListener("click", (event) => openRetellModal(event)));
retellClosers.forEach((button) => button.addEventListener("click", closeRetellModal));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeRetellModal();
    serviceMenus.forEach((menu) => {
      menu.open = false;
    });
    return;
  }

  if (event.key !== "Tab" || !retellModal?.classList.contains("is-open")) return;
  const focusable = Array.from(retellModal.querySelectorAll("button:not(.modal-backdrop), a[href], iframe, [tabindex]:not([tabindex='-1'])"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

const revealElements = document.querySelectorAll(".reveal");

if (reducedMotion.matches) {
  revealElements.forEach((section) => section.classList.add("is-visible"));
} else if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0, rootMargin: "0px 0px -10% 0px" },
  );

  revealElements.forEach((section) => {
    const bounds = section.getBoundingClientRect();
    if (bounds.top < window.innerHeight * 0.94 && bounds.bottom > 0) {
      section.classList.add("is-visible", "is-initial");
      return;
    }
    revealObserver.observe(section);
  });
} else {
  revealElements.forEach((section) => section.classList.add("is-visible"));
}

applySiteConfig();

function loadCalEmbed() {
  const target = document.querySelector("#cal-inline");
  const calLink = target?.getAttribute("data-cal-link");
  if (!target || !calLink) return;

  const loadingState = target.querySelector("[data-cal-loading]");
  const calFrameObserver = new MutationObserver(() => {
    if (!target.querySelector("iframe")) return;
    loadingState?.remove();
    calFrameObserver.disconnect();
  });
  calFrameObserver.observe(target, { childList: true, subtree: true });

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

function scheduleCalEmbed() {
  if (!document.querySelector("#cal-inline")) return;
  window.requestAnimationFrame(() => window.setTimeout(loadCalEmbed, 0));
}

scheduleCalEmbed();
window.addEventListener("load", correctHashScroll);
window.addEventListener("hashchange", correctHashScroll);
