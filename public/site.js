const menuButton = document.querySelector("[data-menu-button]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const retellModal = document.querySelector("[data-retell-modal]");
const retellOpeners = document.querySelectorAll("[data-open-retell]");
const retellClosers = document.querySelectorAll("[data-close-retell]");

const defaultConfig = {
  BRAND_NAME: "Elixis Agency",
  AI_DEMO_ORB_URL: "https://agent.retellai.com/orb/agent_1e77470887528d657c5ad62d4d?token=fea74a2da1190eb438f8613388427a68",
  AI_DEMO_PHONE: "tel:+18887809963",
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
