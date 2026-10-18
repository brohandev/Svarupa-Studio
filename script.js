const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".site-nav");
const header = document.querySelector("[data-header]");

// Switches the header to its compact style once the page has scrolled.
let scrollFrame;
function updateScrollEffects() {
  header?.classList.toggle("is-scrolled", window.scrollY > 24);
  scrollFrame = undefined;
}

function requestScrollEffects() {
  if (scrollFrame !== undefined) return;
  scrollFrame = window.requestAnimationFrame(updateScrollEffects);
}

window.addEventListener("scroll", requestScrollEffects, { passive: true });
updateScrollEffects();

// Stacked sections: each section sticks once its bottom edge meets the bottom of the window,
// so it is fully read before the next section slides over it.
const stackedSections = [...document.querySelectorAll("main > section")];
function updateStickyOffsets() {
  stackedSections.forEach((section) => {
    section.style.setProperty("--sticky-top", `${Math.min(0, window.innerHeight - section.offsetHeight)}px`);
  });
}
const sectionResizeObserver = new ResizeObserver(updateStickyOffsets);
stackedSections.forEach((section) => sectionResizeObserver.observe(section));
window.addEventListener("resize", updateStickyOffsets, { passive: true });
updateStickyOffsets();

// A frozen section reports where it is stuck rather than where it sits in the page, so in-page
// links work out their target from the section's natural position (the heights of the sections above it).
function naturalPageTop(target) {
  const section = target.closest("main > section");
  if (!section) return target.getBoundingClientRect().top + window.scrollY;
  let top = section.parentElement.getBoundingClientRect().top + window.scrollY;
  for (const earlier of stackedSections) {
    if (earlier === section) break;
    top += earlier.offsetHeight;
  }
  return top + target.getBoundingClientRect().top - section.getBoundingClientRect().top;
}

function scrollToTarget(target) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: naturalPageTop(target), behavior: reduceMotion ? "auto" : "smooth" });
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    scrollToTarget(target);
    history.pushState(null, "", link.getAttribute("href"));
  });
});

function closeMenu() {
  menuButton?.setAttribute("aria-expanded", "false");
  nav?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
}

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  nav.classList.toggle("is-open", !isOpen);
  document.body.classList.toggle("menu-open", !isOpen);
});

nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

// Fades each artwork row and the artist lead up into view as they scroll onto the screen.
// Cards in the same row enter together, so each row rises as one.
const revealTargets = document.querySelectorAll(".art-card, .artist-lead");
if ("IntersectionObserver" in window) {
  document.documentElement.classList.add("has-reveal");
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -12% 0px" });
  revealTargets.forEach((target) => {
    target.classList.add("reveal");
    revealObserver.observe(target);
  });
}

const filterButtons = document.querySelectorAll(".filter-button");
const artworkCards = document.querySelectorAll(".art-card");

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    filterButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    artworkCards.forEach((card) => {
      card.classList.toggle("is-hidden", filter !== "all" && card.dataset.category !== filter);
    });
  });
});

document.querySelectorAll(".art-enquire").forEach((button) => {
  button.addEventListener("click", () => {
    const subject = document.querySelector("#subject");
    subject.value = button.dataset.artwork || "";
    scrollToTarget(document.querySelector("#enquire"));
    window.setTimeout(() => subject.focus(), 500);
  });
});

// Commission enquiry: sent in the background to the /api/enquiry Worker route (worker/index.js), which checks
// Cloudflare Turnstile and emails the artist. The artist's address and all keys live in Cloudflare, not here.
const enquiryForm = document.querySelector("#enquire");
const enquiryStatus = document.querySelector("[data-form-status]");
const enquirySent = document.querySelector("[data-enquiry-sent]");
const turnstileSlot = document.querySelector("[data-turnstile]");
let turnstileWidget;

function loadTurnstile() {
  if (!turnstileSlot) return;
  fetch("./api/turnstile-config")
    .then((response) => (response.ok ? response.json() : {}))
    .then(({ siteKey }) => {
      if (!siteKey) return;
      window.onTurnstileLoad = () => {
        turnstileWidget = window.turnstile.render(turnstileSlot, { sitekey: siteKey, action: "enquiry", appearance: "interaction-only" });
      };
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
      script.async = true;
      script.defer = true;
      document.head.append(script);
    })
    .catch(() => {});
}

function showEnquiryStatus(message) {
  enquiryStatus.textContent = message;
  enquiryStatus.hidden = !message;
}

const fieldMessages = {
  name: "Please enter your name.",
  phone: "Please enter your phone number with its country code, for example +65 8123 4567.",
  email: "Please check your email address, or leave it blank.",
  subject: "Please tell us the scene, figure or teaching you have in mind.",
  dimensions: "Please choose approximate dimensions.",
  medium: "Please choose a preferred medium.",
  budget: "Please choose a budget range.",
};

// Highlights every invalid field and returns the first one, so the buyer sees what to fix.
function firstInvalidField() {
  let first;
  enquiryForm.querySelectorAll("input, select, textarea").forEach((control) => {
    if (control.closest(".field-trap") || !control.name || control.name.startsWith("cf-")) return;
    const valid = control.checkValidity();
    control.closest(".field")?.classList.toggle("is-invalid", !valid);
    control.setAttribute("aria-invalid", String(!valid));
    if (!valid && !first) first = control;
  });
  return first;
}

enquiryForm?.addEventListener("input", (event) => {
  const field = event.target.closest(".field");
  if (field?.classList.contains("is-invalid") && event.target.checkValidity()) {
    field.classList.remove("is-invalid");
    event.target.setAttribute("aria-invalid", "false");
  }
});

enquiryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const invalid = firstInvalidField();
  if (invalid) {
    showEnquiryStatus(fieldMessages[invalid.name] || "Please check the highlighted fields.");
    invalid.focus();
    return;
  }

  const token = turnstileWidget !== undefined ? window.turnstile.getResponse(turnstileWidget) : "";
  if (!token) {
    showEnquiryStatus("We're still confirming you're not a robot. Please wait a moment and send again.");
    return;
  }

  const submitButton = enquiryForm.querySelector(".form-submit");
  const buttonLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Sending…";
  showEnquiryStatus("");

  try {
    const response = await fetch("./api/enquiry", { method: "POST", body: new FormData(enquiryForm) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Your enquiry couldn't be sent just now. Please try again in a few minutes.");

    enquiryForm.hidden = true;
    enquirySent.hidden = false;
    enquirySent.focus();
  } catch (error) {
    showEnquiryStatus(error instanceof TypeError ? "We couldn't reach the server. Please check your connection and try again." : error.message);
    if (turnstileWidget !== undefined) window.turnstile.reset(turnstileWidget);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = buttonLabel;
  }
});

loadTurnstile();

document.querySelector("[data-year]").textContent = new Date().getFullYear();
