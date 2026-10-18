// The thank-you email to a new Willo subscriber (LOR-640; Mike, 2026-10-17: "We should probably start setting up an
// automated email service for this"): a short note from Mike, sent through lib/email.js once per account, the first
// time a plan starts. lib/billing.js storeSubscription calls thankSubscriber whenever it stores a paid plan (from
// Stripe's webhook, mostly). Only a subscription that started in the last THANKS_DAYS is thanked, so a renewal, a plan
// change or a subscriber from before this shipped never gets one; and the account's email_sends row
// ("thanks:<user id>") stops a second one, whether from Stripe's retries, the several events of one checkout, or a
// plan started again later. A Keep Hero bought during the beta (a Stripe trial, nothing charged yet) counts as a
// start. The beta's card-less free Hero month doesn't: every signed-in account has one, and it isn't a subscription.
// Mike approves the text before it goes out: until the site feature "thanks" is on (lib/features.js), a start is only
// logged ("would send"), and so it is without an email service (lib/email.js). /api/admin "email-test" sends this
// text to the site's own inbox to try it.

import { sendOnce, senderOf, escapeHtml, UNSUBSCRIBE_URL } from "./email.js";
import { featureOn } from "./features.js";
import { COMPANION_NAME as NAME } from "./brand.js";

export const THANKS_DAYS = 2;
const DISCORD = "https://loreforeverwow.com/discord?src=email";

// What each plan gives, in one line, as /plans says it (lib/billing.js planFeatures). picks: how many voices Champion
// and Legend pick Willo's from (lib/billing.js voicePicks).
const PLAN_LINE = {
  hero: () => `With Hero you can ask ${NAME} out loud and she answers in her voice, and she sees your game too.`,
  champion: picks => `With Champion you can pick ${NAME}'s voice from ${picks}, she remembers more of your chats, ` +
    "and you can write her personality yourself.",
  legend: () => `With Legend you get the most answers and ${NAME}'s finest voice, plus everything in Champion.`,
};

// The email for a plan (planId, planName): {subject, text, html}. firstName: the first word of the account's name from
// Google; trial: a Keep Hero trial; picks: lib/billing.js voicePicks; postal: a mailing address for the footer
// (EMAIL_POSTAL_ADDRESS). Replies reach Mike (lib/email.js REPLY_TO), so it says "hit reply".
export function thankYouEmail({ planId, planName, firstName = "", trial = false, picks = 5, postal = null }) {
  const paras = [
    firstName ? `Hey ${firstName}!` : "Hey!",
    "Mike here, I make Lore Forever. " + (trial
      ? `Just wanted to say thanks for trying ${planName} during the beta, I hope you and ${NAME} have a blast.`
      : `Just wanted to say thanks for picking up ${planName}, it's what keeps this whole thing going.`),
    PLAN_LINE[planId]?.(picks) || "",
    "Anything feel off, or got an idea? Just hit reply, it comes straight to me. Or come find me in the Discord.",
  ].filter(Boolean);
  const footer = `You're getting this one email because you started a ${NAME} plan on loreforeverwow.com. ` +
    "Don't want email from us?";
  // In the text version the Discord link ends its paragraph, with no full stop for a mail app to fold into it.
  const text = [...paras.map(p => p.replace("the Discord.", `the Discord at ${DISCORD}`)), "See you in Azeroth!\nMike",
    `--\n${footer} ${UNSUBSCRIBE_URL}${postal ? `\n${postal}` : ""}`].join("\n\n") + "\n";
  const p = s => `<p style="margin:0 0 16px">${s}</p>`;
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;' +
    'max-width:560px">' +
    paras.map(s => p(escapeHtml(s).replace("the Discord.", `the <a href="${DISCORD}">Discord</a>.`))).join("") +
    p("See you in Azeroth!<br>Mike") +
    `<p style="margin:32px 0 0;font-size:12px;color:#777">${escapeHtml(footer)} <a href="${UNSUBSCRIBE_URL}" ` +
    `style="color:#777">Unsubscribe</a>${postal ? `<br>${escapeHtml(postal)}` : ""}</p></div>`;
  return { subject: `Thanks for ${trial ? "trying" : "picking up"} ${planName}!`, text, html };
}

// The first word of a name, for "Hey Aelric!": letters, digits and a few joiners only, so nothing odd lands in it.
const firstWord = name => (String(name ?? "").trim().split(/\s+/)[0] || "").replace(/[^\p{L}\p{N}'.-]/gu, "").slice(0, 30);

// Thanks the account for a plan that just started (plan: {id, name, picks}; trial: Stripe's trialing), once ever. The
// send's status (lib/email.js sendOnce), or "not new" for a subscription that started more than THANKS_DAYS ago.
// Never throws.
export async function thankSubscriber(env, userId, subscription, { id, name, picks, trial = false }) {
  const started = Number(subscription?.start_date ?? subscription?.created) * 1000;
  if (!(started > Date.now() - THANKS_DAYS * 86400e3)) return "not new";
  try {
    const user = await env.DB.prepare("SELECT email, display_name FROM users WHERE id = ?").bind(userId).first();
    const message = { to: user?.email, ...thankYouEmail({ planId: id, planName: name,
      firstName: firstWord(user?.display_name), trial, picks, postal: senderOf(env).postal }) };
    return await sendOnce(env, { id: `thanks:${userId}`, kind: "thanks", userId, message,
      off: !featureOn(env, "thanks") });
  } catch (e) {
    console.warn(`thanks: ${userId}: ${e?.message || e}`);
    return "failed";
  }
}
