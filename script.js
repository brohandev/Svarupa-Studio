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

// Fades each artwork row and the whole artist column (eyebrow, heading, lead, paragraph, link) up into view as they
// scroll onto the screen. Cards in the same row enter together, so each row rises as one.
const revealTargets = document.querySelectorAll(".art-card, .artist-copy > *");
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

// "Subject of Enquiry" multi-select. Options are built from the art cards each time the page loads: every card whose
// availability reads "Available" is listed by its title, followed by "Private commission". Adding, renaming or
// marking a card unavailable in index.html updates the list automatically.
const PRIVATE_COMMISSION = "Private commission";
const subjectSelect = document.querySelector("[data-subject-select]");
const subjectTrigger = subjectSelect?.querySelector(".multi-select-trigger");
const subjectPanel = subjectSelect?.querySelector(".multi-select-panel");
const subjectSummary = subjectSelect?.querySelector(".multi-select-summary");
const commissionIdea = document.querySelector("[data-commission-idea]");
const commissionInput = commissionIdea?.querySelector("input");

function cardTitle(card) {
  return card.querySelector("h3")?.textContent.trim() || "";
}

function isCardAvailable(card) {
  return card.querySelector(".availability")?.textContent.trim().toLowerCase() === "available";
}

function subjectBoxes() {
  return [...(subjectPanel?.querySelectorAll('input[name="subject"]') || [])];
}

function buildSubjectOptions() {
  const titles = [...new Set([...artworkCards].filter(isCardAvailable).map(cardTitle).filter(Boolean))];
  [...titles, PRIVATE_COMMISSION].forEach((title) => {
    const option = document.createElement("label");
    option.className = "multi-select-option";
    if (title === PRIVATE_COMMISSION) option.classList.add("is-commission");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = "subject";
    box.value = title;
    const text = document.createElement("span");
    text.textContent = title;
    option.append(box, text);
    subjectPanel.append(option);
  });
}

// Refreshes the closed field's summary, the "at least one" rule, and the commission-idea field.
function updateSubject() {
  const boxes = subjectBoxes();
  const chosen = boxes.filter((box) => box.checked).map((box) => box.value);
  subjectSummary.textContent = chosen.length === 0 ? "Select artworks"
    : chosen.length === 1 ? chosen[0] : `${chosen[0]}, +${chosen.length - 1} more`;
  subjectSummary.classList.toggle("is-placeholder", chosen.length === 0);
  boxes[0]?.setCustomValidity(chosen.length ? "" : "Choose at least one artwork, or Private commission.");

  const wantsCommission = chosen.includes(PRIVATE_COMMISSION);
  commissionIdea.hidden = !wantsCommission;
  commissionInput.disabled = !wantsCommission;
  commissionInput.required = wantsCommission;
}

function setSubjectOpen(open, { focusOption = false } = {}) {
  subjectPanel.hidden = !open;
  subjectTrigger.setAttribute("aria-expanded", String(open));
  if (open && focusOption) (subjectBoxes().find((box) => box.checked) || subjectBoxes()[0])?.focus();
}

if (subjectSelect) {
  buildSubjectOptions();
  updateSubject();
  subjectTrigger.addEventListener("click", () => setSubjectOpen(subjectPanel.hidden, { focusOption: true }));
  subjectPanel.addEventListener("input", updateSubject);
  subjectSelect.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !subjectPanel.hidden) {
      event.preventDefault();
      setSubjectOpen(false);
      subjectTrigger.focus();
    }
  });
  subjectSelect.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !subjectSelect.contains(event.relatedTarget)) setSubjectOpen(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!subjectPanel.hidden && !subjectSelect.contains(event.target)) setSubjectOpen(false);
  });
}

// Each card's Enquire button ticks that artwork (or "Private commission" for works that aren't available) and
// scrolls to the form. Ticks add up, so a buyer can gather several works before writing.
document.querySelectorAll(".art-enquire").forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".art-card");
    const value = card && isCardAvailable(card) ? cardTitle(card) : PRIVATE_COMMISSION;
    const box = subjectBoxes().find((option) => option.value === value);
    if (box) {
      box.checked = true;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }
    scrollToTarget(document.querySelector("#enquire"));
    window.setTimeout(() => (value === PRIVATE_COMMISSION ? commissionInput : subjectTrigger)?.focus(), 500);
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

// Phone number: a country calling-code dropdown (from countries.js; Singapore pinned and pre-selected) plus the local
// number, joined into one international number when the form is sent.
const phoneCountry = document.querySelector("[data-phone-country]");
const phoneCountryDisplay = document.querySelector("[data-phone-country-display]");
const phoneNumber = document.querySelector("#phone");
const DEFAULT_COUNTRY = "SG";
// Countries whose numbers keep their leading 0 after the country code; elsewhere a leading 0 is the domestic
// trunk prefix (e.g. UK 07946… becomes +44 7946…).
const KEEPS_LEADING_ZERO = new Set(["IT", "SM", "VA", "CI"]);

function flagFor(iso) {
  return String.fromCodePoint(...[...iso].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

function countryOption(iso, name, dial) {
  const option = new Option(`${flagFor(iso)} ${name} (+${dial})`, iso);
  option.dataset.dial = dial;
  option.dataset.name = name;
  return option;
}

function buildPhoneCountries() {
  const countries = [...(window.SVARUPA_COUNTRIES || [])].sort((a, b) => a[1].localeCompare(b[1], "en"));
  const pinned = countries.find(([iso]) => iso === DEFAULT_COUNTRY);
  if (!pinned) return;
  const divider = new Option("──────────", "");
  divider.disabled = true;
  phoneCountry.replaceChildren(countryOption(...pinned), divider, ...countries.map((country) => countryOption(...country)));
  phoneCountry.selectedIndex = 0;
}

function selectedCountry() {
  const option = phoneCountry.selectedOptions[0];
  return { iso: option?.value || DEFAULT_COUNTRY, dial: option?.dataset.dial || "65", name: option?.dataset.name || "Singapore" };
}

function updatePhoneCountryDisplay() {
  const { iso, dial } = selectedCountry();
  phoneCountryDisplay.textContent = `${flagFor(iso)} +${dial}`;
}

// Joins the calling code and local number into "+<code> <number>". A number typed with its own "+" or "00" prefix is
// taken as already international.
function internationalPhone() {
  const typed = phoneNumber.value.trim().replace(/\s+/g, " ");
  if (typed.startsWith("+")) return typed;
  if (typed.startsWith("00")) return `+${typed.slice(2).trim()}`;
  const { iso, dial } = selectedCountry();
  const local = KEEPS_LEADING_ZERO.has(iso) ? typed : typed.replace(/^0+(?=\d)/, "");
  return `+${dial} ${local}`;
}

function updatePhoneValidity() {
  const typedDigits = phoneNumber.value.replace(/\D/g, "").length;
  const fullDigits = internationalPhone().replace(/\D/g, "").length;
  const plausible = typedDigits >= 4 && fullDigits >= 8 && fullDigits <= 15;
  phoneNumber.setCustomValidity(!phoneNumber.value.trim() || plausible ? "" : "Please check the phone number.");
}

if (phoneCountry && phoneNumber) {
  buildPhoneCountries();
  updatePhoneCountryDisplay();
  phoneCountry.addEventListener("change", () => {
    updatePhoneCountryDisplay();
    updatePhoneValidity();
  });
  phoneNumber.addEventListener("input", updatePhoneValidity);
}

const fieldMessages = {
  name: "Please enter your name.",
  phone_national: "Please enter a valid phone number for the country you've chosen.",
  email: "Please check your email address, or leave it blank.",
  subject: "Please choose at least one artwork, or Private commission.",
  commission_subject: "Please tell us the scene, figure or teaching you would like painted.",
  dimensions: "Please choose approximate dimensions.",
  medium: "Please choose a preferred medium.",
  budget: "Please choose a budget range.",
};

// Highlights every invalid field and returns the first one, so the buyer sees what to fix.
// The artwork checkboxes count as one field; its "at least one" rule is carried by the first checkbox.
function firstInvalidField() {
  let first;
  updateSubject();
  updatePhoneValidity();
  enquiryForm.querySelectorAll("input, select, textarea").forEach((control) => {
    if (control.closest(".field-trap") || !control.name || control.name.startsWith("cf-")) return;
    if (control.type === "checkbox" && control !== subjectBoxes()[0]) return;
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
    (invalid.type === "checkbox" ? subjectTrigger : invalid).focus();
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
    const payload = new FormData(enquiryForm);
    payload.set("phone", internationalPhone());
    payload.set("phone_country", selectedCountry().name);
    payload.delete("phone_national");
    const response = await fetch("./api/enquiry", { method: "POST", body: payload });
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
