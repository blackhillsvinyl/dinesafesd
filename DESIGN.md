---
name: DineSafeSD
description: South Dakota restaurant health inspections on a map — free, fast, factual.
colors:
  inspection-green: "#15803d"
  green-deep: "#166534"
  passing-green: "#16a34a"
  mint: "#dcfce7"
  mint-wash: "#f0fdf4"
  caution-amber: "#a16207"
  caution-marker: "#facc15"
  alert-orange: "#c2410c"
  alert-marker: "#f97316"
  critical-red: "#b91c1c"
  critical-marker: "#dc2626"
  critical-wash: "#fee2e2"
  gold-star: "#ca8a04"
  ink: "#0f172a"
  slate: "#64748b"
  faint: "#94a3b8"
  active-slate: "#334155"
  hairline: "#e2e8f0"
  mist: "#f1f5f9"
  frost: "#f8fafc"
  paper: "#fafaf9"
  card: "#ffffff"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-1px"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    letterSpacing: "-0.6px"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 800
    letterSpacing: "-0.3px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.6px"
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  2xl: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.inspection-green}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.green-deep}"
  chip-filter:
    backgroundColor: "{colors.card}"
    textColor: "{colors.slate}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  chip-filter-active:
    backgroundColor: "{colors.active-slate}"
    textColor: "#ffffff"
  card-result:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "14px 16px"
  input-search:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  pill-score:
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 0"
    width: "46px"
---

# Design System: DineSafeSD

## Overview

**Creative North Star: "The Pocket Field Guide"**

DineSafeSD is the trustworthy reference you pull out before a meal: compact, indexed, friendly but factual. Like a good field guide, it is organized for identification at a glance — a fixed color-coded scoring key, big unambiguous numerals, and dense-but-breathable entries you can flip through in seconds while standing outside a restaurant. The voice is trustworthy, brisk, and plainspoken: the design gets you to a number fast and never dramatizes it.

The system is quiet by construction so the data can be loud. Nearly everything is paper-and-slate — a warm off-white page, white cards, hairline borders, slate text — and color is reserved for exactly two jobs: the brand's Inspection Green (the SD-outline checkmark, navigation, calls to action) and the five-band score ramp. Components are soft-edged utility: rounded corners, hairline borders, whisper shadows, and one glassy floating card over the map. Nothing decorative, nothing invented — the app reports official data and its design must feel like it.

**Key Characteristics:**
- Paper-quiet chrome; color belongs almost exclusively to scores and the brand green
- Big raw numerals (out of 100, tabular, weight 900) — never letter grades or adjectives
- A fixed five-band score ramp (dark green → light green → yellow → orange → red)
- Soft-edged utility components: hairline borders, 6–16px radii, flat by default
- System font stack on every platform; no custom faces
- One signature mark: the South Dakota outline in Inspection Green with a white check

## Colors

A paper-and-slate neutral field where the only saturated voices are the brand green and the five-band score ramp (all values are Tailwind-palette colors; the ramp is defined in `apps/web/src/scoring.ts` and mirrored in `apps/mobile/utils/scoring.ts`).

### Primary
- **Inspection Green** (#15803d): The color of a passed inspection. Carries the logo mark, active nav states, primary CTAs, links, focused input borders, and the top score tier (96–100). Interactive elements own it; decoration does not.
- **Green Deep** (#166534): Hover/pressed state of Inspection Green surfaces.
- **Mint Wash** (#f0fdf4) / **Mint** (#dcfce7): Pale green tints for active-nav backgrounds, "clean report" callouts, hover fills, and the pressed state of green-tinted actions.

### Secondary — the score ramp
The five-band ramp steps dark green → light green → yellow → orange → red so adjacent bands stay distinguishable on the map. Each band has a text/accent color, a pale wash background, and a marker color:

- **96–100**: text #15803d, wash #dcfce7, marker #15803d
- **90–95** — **Passing Green** (#16a34a): wash #f0fdf4, marker #4ade80
- **83–89** — **Caution Amber** (#a16207): wash #fef9c3, marker #facc15
- **76–82** — **Alert Orange** (#c2410c): wash #ffedd5, marker #f97316
- **0–75** — **Critical Red** (#b91c1c): wash #fee2e2, marker #dc2626
- **No score**: text/marker #94a3b8, wash #f1f5f9

**Critical Red** (#b91c1c) also flags critical-violation callouts; **Gold Star** (#ca8a04) marks a perfect 100 with a small star.

### Neutral
- **Ink** (#0f172a): Primary text; also the mobile tab bar background and the dark scrim of the map hint toast.
- **Slate** (#64748b): Secondary text — addresses, metadata, inactive nav.
- **Faint** (#94a3b8): Tertiary text — timestamps, counts, "no score" state.
- **Active Slate** (#334155): The selected filter chip fill — the one interactive element that is deliberately not green, so filters never read as scores.
- **Hairline** (#e2e8f0): The structural border on cards, inputs, and dividers.
- **Mist** (#f1f5f9) / **Frost** (#f8fafc): Recessed fills — hover states, chip backgrounds, violation rows.
- **Paper** (#fafaf9): The page background, a warm stone white.
- **Card** (#ffffff): All card and sheet surfaces.

### Named Rules
**The Two Voices Rule.** Only two things are allowed to be colorful: the brand's Inspection Green and the score ramp. Any new hue must justify itself as a third voice — and almost nothing qualifies.

**The Never-Alone Rule.** Score color never carries meaning by itself; it always accompanies the numeral (or a dot beside a labeled score). Color-blind users get the same answer.

## Typography

**Display Font:** System stack (-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif)
**Body Font:** Same system stack
**Label/Mono Font:** None — numerals use `font-variant-numeric: tabular-nums` instead of a mono face

**Character:** The platform's own voice, pushed hard at the extremes: featherweight chrome text against very heavy, tightly-tracked numerals and names. Authority comes from weight contrast, not from a custom face.

### Hierarchy
- **Display** (900, 24–30px, line-height 1, letter-spacing -1px, tabular-nums): Score numerals — the quick-view score, the 84px circular detail badge (30px), score pills. Always raw out of 100.
- **Headline** (700, 26px, letter-spacing -0.6px): Page titles (23px under 560px).
- **Title** (800, 15–16px, letter-spacing -0.3px): Restaurant names, section heads, the 20px/900 brand wordmark.
- **Body** (400, 15px, line-height 1.6): Paragraph and list text on content pages, colored #374151.
- **Label** (700, 10–11px, letter-spacing 0.3–0.6px, often uppercase): Chip text, violation codes, "/100" denominators, section micro-labels.

### Named Rules
**The Raw Number Rule.** Scores are shown as raw numerals out of 100 in Display weight — never letter grades, never adjective labels ("Good", "Poor"), never re-interpreted. Tabular figures everywhere a number can change.

## Layout

Two spatial models. **Map surfaces** are full-bleed edge-to-edge, with floating layers anchored to edges: city search top-left, quick-view card bottom-center (min(400px, 100% − 24px)), hint toasts bottom-center, all respecting `env(safe-area-inset-bottom)`. **Content pages** are a single centered 760px column (28px/18px padding, 64px bottom).

Spacing runs a 4px-flavored rhythm used loosely: 4/8/12/16/24, with 10 and 14 as common in-between card gaps and paddings. Density is "field guide" — entries are compact (14–16px card padding, 10px list gaps) but never cramped, and every tap target keeps a 44px minimum height.

One breakpoint: 560px. Below it, padding tightens, the brand word drops to 18px, and the quick-view docks nearly full-width to the bottom edge with safe-area padding. On native mobile, structure follows the platform: a bottom tab bar (Ink background, Inspection Green active tint), native stacks, and platform navigation patterns rather than the web header.

## Elevation & Depth

Flat by default: hairline borders (#e2e8f0) do the structural work, and resting surfaces on the web carry no shadow. Shadows exist for exactly one reason — to say "this floats above the map." The floating quick-view and city-search dropdown pair a soft ambient shadow with a frosted-glass treatment (rgba(255,255,255,0.95) + backdrop-blur 6–8px). Native mobile cards may carry a barely-there lift (opacity ≤ 0.08) because there are no hairline-hover affordances on touch.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 28px rgba(15, 23, 42, 0.22)`): The map quick-view — the strongest shadow in the system.
- **Dropdown** (`box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16)`): City-search results list.
- **Field-float** (`box-shadow: 0 2px 10px rgba(15, 23, 42, 0.12)`): The floating map search input.
- **Native lift** (shadowOpacity 0.06–0.08, radius 3–4, elevation 1–2): Mobile cards and score pills only.

### Named Rules
**The Float-Earns-Shadow Rule.** A surface gets a shadow only if it hovers above the map or another surface. Resting cards are bordered, not lifted. Shadow tint is always Ink (rgba(15,23,42,…)), never gray or black.

## Shapes

Soft-edged utility: everything is rounded, nothing is round for its own sake. Radii scale with component size — 6px micro-chips, 8px violation rows and small pills, 10px buttons and nav links, 12px cards and inputs, 14–16px larger cards and the floating quick-view (18px top corners when docked to the mobile bottom edge). Filter chips and the map hint are full pills (999px). Two deliberate circles: the 84px detail score badge and the 10–12px legend/marker dots. Borders are 1px hairlines; the only heavier strokes are the white 2px ring around legend dots and the 4px rounded color bar that spines each violation row. The signature silhouette is the South Dakota state outline itself, filled Inspection Green and crossed by a white 9-unit round-capped check.

## Components

### Buttons
- **Shape:** Gently rounded (10px)
- **Primary:** Inspection Green fill, white text, 800 weight at 13px, centered, min-height 44px (`.qv-cta`)
- **Hover / Focus:** Fill deepens to Green Deep (#166534); inputs focus by swapping border to Inspection Green — no glow rings
- **Ghost/secondary:** Not a distinct class — secondary actions are text-and-icon rows on Mist hover fills (see the mobile card action strip)

### Chips
- **Filter chips:** Pill-shaped (999px), white fill, hairline border, 600-weight 13px Slate text; selected state flips to Active Slate fill with white text — deliberately not green
- **Violation chips:** 6px radius, Frost fill, 11px/700 text, 1px border in the violation category's color

### Cards / Containers
- **Corner Style:** 12px (web), 14px (mobile)
- **Background:** Card white on Paper page
- **Shadow Strategy:** None at rest on web (Float-Earns-Shadow); native lift on mobile
- **Border:** 1px Hairline; hover swaps border to Inspection Green as the affordance
- **Internal Padding:** 14–16px, 10px between stacked cards

### Inputs / Fields
- **Style:** White fill, 1px Hairline border, 12px radius, 16px text (prevents iOS zoom), 12px/16px padding
- **Focus:** Border becomes Inspection Green; no shadow, no ring
- **Map variant:** Frosted glass (rgba white 0.95 + blur 6px) with Field-float shadow

### Navigation
- **Web:** Text links at 15px/600 in Slate, 9px-radius rounded hover (Mist fill); active state is Inspection Green text on Mint Wash. Brand lockup: SD-outline mark + 20px/900 wordmark with the "SD" in green
- **Mobile:** Bottom tab bar, Ink background, Inspection Green active / Slate inactive tints, Ionicons

### Score Pill (signature)
The system's atom: a compact rounded rectangle (8–12px by size) carrying a Display-weight tabular numeral. Two schemes — solid marker-color fill with white text (search results, inspection history), or tier-wash background with tier-color text (quick-view, mobile cards, with a 9px "/100" denominator in Faint). A perfect 100 earns a small Gold Star. No score renders as "—" in Faint on Mist.

### Quick View (signature)
The floating field-guide entry: frosted glass card (rgba(255,255,255,0.95), blur 8px, 16px radius, Float shadow) docked bottom-center over the map, holding a wash-style score pill, ellipsized name and address, violation chips, a clean/critical callout row, and a full-width primary CTA.

## Do's and Don'ts

### Do:
- **Do** pair every score color with its numeral or a text label (The Never-Alone Rule).
- **Do** use `tabular-nums` on every number that can change — scores, counts, distances.
- **Do** keep tap targets at 44px minimum height; the quick-view CTA already models this.
- **Do** use the five-band ramp exactly as defined in `scoring.ts` — both apps must stay mirror-identical.
- **Do** structure with hairline borders and reserve shadows for floating overlays.
- **Do** respect safe-area insets on anything docked to a screen edge.

### Don't:
- **Don't** translate scores into letter grades, star ratings, or adjectives — raw numbers only (The Raw Number Rule).
- **Don't** introduce new saturated hues beyond Inspection Green and the score ramp (The Two Voices Rule).
- **Don't** add custom fonts; the system stack is the voice on every platform.
- **Don't** make filter/selection states green — selection is Active Slate so it can never be misread as a score.
- **Don't** shadow resting cards on the web or tint shadows anything but Ink.
- **Don't** editorialize in UI copy — "3 critical violations," never "dirty" or "unsafe."
