# Chess-Publisher Hub — Public UX Contract

Status: **BETA UX CONTRACT**

The public tournament experience must be designed mobile-first and remain equally strong on desktop. A desktop table shrunk onto a phone is not an acceptable implementation.

## 1. Supported viewport targets

Required design/test widths:

- 320 px — minimum supported narrow mobile;
- 360 / 390 / 430 px — common phones;
- 768 px — tablet portrait;
- 1024 px — tablet / small desktop;
- 1280 / 1440 px — standard desktop;
- 1920 px — wide desktop.

No page-level horizontal scrolling is allowed at supported widths.

## 2. Breakpoint policy

Suggested layout breakpoints:

- `<= 419px` compact phone;
- `420–639px` phone;
- `640–899px` large phone/tablet;
- `900–1199px` compact desktop/tablet landscape;
- `>= 1200px` full desktop.

Breakpoints are content-driven. Components may switch earlier when their content requires it.

## 3. Tournament page information hierarchy

Every public tournament page must expose the most important information without searching through menus:

1. tournament name;
2. status (Upcoming / Registration / Playing / Finished);
3. current/latest round;
4. location and dates;
5. time control / format;
6. primary navigation: Overview, Players, Pairings, Standings;
7. last updated timestamp.

Secondary data may be progressively disclosed.

## 4. Mobile behavior

### Navigation

- compact sticky tournament header;
- horizontally scrollable tab strip or compact menu with clear current section;
- minimum touch target: 44 × 44 px;
- never rely on hover;
- browser back/forward must work with public routes.

### Pairings

On mobile, pairings are rendered as board cards rather than a six-column desktop table.

Card hierarchy:

```text
Board 12
White player                     1
Rtg 2140 • BUL
              1–0
Black player                     0
Rtg 2078 • TUR
```

Exact visual treatment may change, but board, both player names and result must be visible without horizontal scrolling.

### Standings

Mobile standings prioritize:

- rank;
- player;
- federation;
- rating when space permits;
- points.

Tie-break values are shown in an expandable details area or an intentional horizontal data region inside the component. The whole page must not overflow.

### Players

Player list uses compact rows/cards with:

- starting rank;
- player name;
- federation;
- rating;
- FIDE ID in secondary detail when present.

### Filters

Search/filter controls stack vertically on narrow phones and must use at least 16 px input text to avoid mobile browser zoom behavior.

## 5. Desktop behavior

Desktop may use data-dense tables, but they must remain readable and stable.

Target container width: approximately 1280–1440 px with responsive gutters.

### Pairings table

Recommended columns:

- Board;
- White;
- Rtg;
- Result;
- Black;
- Rtg.

Player names receive the majority of available width. Result and board columns remain fixed/compact.

### Standings table

Recommended columns:

- Rank;
- Player;
- FED;
- Rtg;
- Pts;
- configured tie-breaks.

The header may become sticky for long events. Tie-break abbreviations must have accessible full labels.

## 6. Responsive component rule

The DOM/data model may be shared, but mobile and desktop presentation are allowed to differ substantially.

Preferred strategy:

- semantic desktop table for wide screens;
- mobile card/list rendering for dense tournament data;
- CSS-only adaptation where practical;
- JavaScript rendering changes only when they improve semantics or performance.

Do not hide essential tournament information merely to make a layout fit.

## 7. Accessibility baseline

Target: WCAG 2.2 AA for the public Hub UI.

Required:

- sufficient color contrast;
- visible keyboard focus;
- semantic headings and landmarks;
- labels for inputs;
- table headers associated with data cells;
- status not conveyed only by color;
- reduced-motion preference respected;
- usable at 200% browser zoom;
- screen-reader-friendly result notation;
- language metadata on documents.

## 8. Performance budget

The tournament public page should remain lightweight even for large events.

Beta targets:

- no heavy UI framework required for the read-only public page;
- route shell usable before non-essential enhancements load;
- lazy/virtualized rendering considered for very large lists;
- revision/ETag caching for API responses;
- avoid blocking third-party scripts;
- image/media features must not block pairings or standings.

Target Core Web Vitals on a representative mobile connection:

- LCP <= 2.5 s;
- CLS <= 0.1;
- INP <= 200 ms where practical.

## 9. Visual design direction

The public Hub should visually belong to `chess-publisher.org`, while being more data-oriented than the marketing home page.

Design principles:

- clean light surfaces;
- strong tournament title hierarchy;
- restrained navy/accent palette inherited from the site;
- clear status badges;
- dense but calm desktop tables;
- generous mobile spacing and touch targets;
- no Windows-classic styling on the public website.

The desktop Chess-Publisher application may retain its established native/classic visual language; the public Hub website is a separate participant-facing experience.

## 10. Empty, loading and error states

Every public route must define:

- loading state;
- no data yet;
- round not generated;
- standings not available;
- tournament unpublished/removed;
- API temporarily unavailable;
- stale cached data available.

If cached public data exists during an API outage, prefer showing it with a visible `Last updated` timestamp over showing an empty page.

## 11. Browser/device test gate

Before RC, verify at minimum:

- current Chrome desktop and Android;
- current Edge desktop;
- current Firefox desktop;
- current Safari macOS/iOS where available;
- Android WebView/Chrome common phone sizes;
- touch and keyboard navigation;
- portrait and landscape for mobile/tablet.

## 12. Acceptance criteria for Beta 2

Beta 2 public UI is not complete until:

1. 320 px viewport has no page-level horizontal overflow;
2. pairings are fully usable at 360 px;
3. standings are fully usable at 360 px;
4. desktop pairings/standings remain data dense at 1280+ px;
5. navigation works with touch, mouse and keyboard;
6. loading/empty/error states are implemented;
7. real large-tournament fixtures are tested;
8. accessibility smoke checks pass.
