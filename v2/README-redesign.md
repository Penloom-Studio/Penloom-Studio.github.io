# Penloom Storefront v2 — Redesign Proposal

**Status:** PROPOSAL ONLY. Nothing here is live. These files sit in `storefront/v2/`
and do not touch the current live files in `storefront/`. Go live only after you
review and the DNS / deploy target is pointed here.

## Files in this proposal
- `v2/index.html` — rebuilt homepage
- `v2/america-250.html` — exemplar per-niche landing page (America 250 collection)
- `v2/README-redesign.md` — this note

The v2 pages link out to the **existing** landing/free-tool pages that already live
in `storefront/` (`ai-basics-chatgpt.html`, `invoice-tracker.html`, `field-guide.html`,
`invoice-reminder-generator.html`). Those were not modified. If you deploy v2 as the
site root, keep those sibling pages alongside it (or copy them into `v2/`).

---

## Price / link audit (what I checked and what I found)

I verified every price and every `buy.stripe.com` link against the current files and
reused the exact links — none were invented. Verified table:

| Product | Price (kept) | Stripe link (reused verbatim) |
|---|---|---|
| The Great American Trivia Pack (America 250) | **$1.99** | `buy.stripe.com/5kQ4gy7p0caq0n9fX93F606` |
| AI Basics — Class 1: ChatGPT | $9 | `buy.stripe.com/8x200idNo1vM2vhcKX3F605` |
| The Agent Builder's Toolkit | $19 | `buy.stripe.com/aFa3cu9x8deub1N9yL3F601` |
| The Claude Code Power-User Pack | $17 | `buy.stripe.com/7sYaEWdNo0rI6LxdP13F602` |
| Invoice Follow-Up Tracker | $24 | `buy.stripe.com/aFa9AS6kW2zQ3zlh1d3F603` |

### On the reported "$9 trivia" bug
The brief flagged the America 250 Trivia Pack wrongly showing **$9** on the live site,
suspected as a top cause of checkout abandonment. In the current **repo** files the
trivia pack is already consistently **$1.99** everywhere (`index.html` banner,
`america-250-trivia.html` copy + JSON-LD + Stripe button). So the $9 is almost
certainly a **stale deployed version** — the fix exists in the repo but hasn't shipped.

The one `$9` you *will* see in `index.html` (line ~333) is the **AI Basics ChatGPT
class**, which is correctly $9 and matches its own landing page. That is not the bug —
don't "fix" it down.

**Action for owner:** the real fix is a *deploy*, not a code change. Confirm what's
actually live at penloomstudio.com; if it still shows $9 for trivia, deploying the
current repo (or this v2) resolves it. v2 pins the trivia pack to $1.99 in copy, in
both hero + final CTAs, in JSON-LD, and in meta tags.

### Other consistency fixes rolled into v2
- Added valid **FAQPage** JSON-LD to the homepage (the old homepage had Product +
  Org/WebSite schema but no FAQ schema, despite having an on-page FAQ).
- Homepage JSON-LD now includes **all five products** (old one listed only the 3 core
  paid products; Trivia and AI Basics were missing from structured data).
- Every JSON-LD `price` matches the on-page price and the Stripe button label.

---

## Biggest conversion improvements vs the old site

1. **"Which one are you?" audience picker directly under the hero.** The old homepage
   had four audiences (New-to-AI, AI builders, freelancers, America 250) stacked in a
   long scroll; a first-time visitor had to read past lanes that weren't for them. v2
   adds a 4-card self-select grid at the top so each visitor reaches their product in
   one tap — less scrolling, less bounce, faster path to a buy button.

2. **Every impulse CTA links DIRECTLY to Stripe.** Buy buttons (`Get the Toolkit`,
   `Start Class 1`, `Get the Tracker`, `Get the Trivia Pack`) go straight to the
   correct `buy.stripe.com` checkout — no intermediate page required for the impulse
   purchase. "See what's inside" remains as a secondary ghost button for people who
   want detail first. This shortens the click path that's most likely to leak.

3. **Trust signals made explicit and repeated at the decision point.** The America 250
   page and each card restate *secure Stripe checkout · one-time · 14-day guarantee ·
   instant email delivery* right next to the price — the moment doubt peaks. The old
   site had trust badges only in the hero and a separate "why" band far down the page.

4. **America 250 promoted to a real landing page + impulse-buy hero.** The old site
   had only a slim banner. v2 gives the $1.99 pack a full page with a prominent
   above-the-fold buy card (the cheapest, lowest-risk product is the best "first yes"),
   plus an honest **"coming soon"** apparel section — no fake product, no fake price.

5. **Consistent, correct pricing + fuller structured data.** Fixing the $1.99/$9
   inconsistency (the suspected #1 abandonment cause) and completing the JSON-LD means
   the price a shopper sees matches the price at checkout — the single biggest driver
   of "looks like it drives people away at checkout." No price surprise = no bounce.

Kept from the old site (deliberately, because they already worked): the indigo→violet
AI palette, amber SMB accent, navy+red America 250 palette, brand tokens, sticky nav,
benefit-led cards, the honest free-tools strip, the dark "why" band, and the FAQ.

## Honesty notes
- **No fake testimonials, reviews, ratings, or sales counts** anywhere. Social proof is
  limited to honest, verifiable claims (Stripe, instant email delivery, one-time
  purchase, guarantee). If you later have real numbers or quotes, a placeholder
  "social proof" row can be dropped into the homepage between the lanes and the "why"
  band.
- The apparel section is clearly labeled **Coming soon** with no price and no buy
  button, so no one can try to purchase something that doesn't exist yet.

---

## What remains for the owner to decide
1. **Deploy the price fix.** Confirm the live site and ship (this is the urgent one).
2. **Go-live for v2:** approve, then repoint the deploy/DNS to serve `v2/` — and decide
   whether to copy the sibling landing pages into `v2/` or serve them from the same root.
3. **Apparel:** confirm whether state-pride apparel is really coming; if not, remove the
   "coming soon" section before launch.
4. **Real social proof:** if/when you have genuine reviews or sales numbers, tell me and
   I'll add an honest social-proof row.
5. **OG image:** both pages reference `penloom-card.png`; confirm it exists at the deploy
   root so link previews render.
6. **Privacy/Terms links** point to `/privacy.html` and `/terms.html` — confirm those
   exist at the deploy root.
