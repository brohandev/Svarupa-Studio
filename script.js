// EDITING NOTE: The WhatsApp number is not stored in this repository. It lives in the WHATSAPP_NUMBER secret on the
// Cloudflare Worker and is used by worker/index.js.

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

document.querySelector("#enquire")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const message = [
    "Hello Svarupa Studio, I would like to enquire about a commissioned artwork.",
    "",
    `Name: ${data.get("name")}`,
    `Subject: ${data.get("subject")}`,
    `Approximate dimensions: ${data.get("dimensions")}`,
    `Preferred medium: ${data.get("medium")}`,
    `Budget: ${data.get("budget")}`,
    data.get("notes") ? `Notes: ${data.get("notes")}` : "",
    "",
    "I understand that fulfilment is currently limited to Singapore.",
  ].filter(Boolean).join("\n");

  // Hand the message to the /whatsapp Worker route via the footer's WhatsApp form; the number never reaches the page.
  const whatsappForm = document.querySelector("#whatsapp-form");
  whatsappForm.elements.text.value = message;
  whatsappForm.submit();
  whatsappForm.elements.text.value = "";
});

document.querySelector("[data-year]").textContent = new Date().getFullYear();
