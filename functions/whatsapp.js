// Cloudflare Pages Function served at /whatsapp.
//
// Keeps the studio's WhatsApp number out of the repository and the page source: the site posts its message here,
// and this function redirects the visitor to WhatsApp using the number stored in the WHATSAPP_NUMBER environment
// variable (Cloudflare dashboard > Pages project > Settings > Variables and Secrets, type "Secret").
// For local testing with `npx wrangler pages dev .`, put WHATSAPP_NUMBER=... in a .dev.vars file (git-ignored).
//
// Only POST is answered, so crawlers that follow ordinary links never receive the redirect.

const MAX_MESSAGE_LENGTH = 2000;

export async function onRequestPost({ request, env }) {
  const number = String(env.WHATSAPP_NUMBER || "").replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(number)) {
    return new Response("WhatsApp contact is not configured.", { status: 500 });
  }

  const form = await request.formData();
  const text = String(form.get("text") || "").slice(0, MAX_MESSAGE_LENGTH);
  const query = text ? `?text=${encodeURIComponent(text)}` : "";

  return new Response(null, {
    status: 303,
    headers: {
      Location: `https://wa.me/${number}${query}`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
