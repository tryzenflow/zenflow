# Design System

Zenflow's visual language. All mockups and production UI implement this specification.

---

## Design Choices

### Style: New York

1px focus ring, 0px offset. Rationale: the tighter ring reduces visual noise for users who spend hours looking at the calendar. The default 2px ring with offset creates a "floating" highlight effect that is distracting on a dense time grid.

### Base Color: Stone

Stone (hue ≈ 106–107) has warm undertones absent from Zinc's cool gray. For a stress-reduction app, warm neutrals are psychologically calming — they prevent the "cold spreadsheet" association that undermines trust in the tool. Stone also pairs exceptionally well with Violet without competing.

### Accent: Violet

Violet (hue ≈ 302) is meaningfully distinct from Indigo (hue ≈ 265). Moving warmer on the color wheel:
- Associates with creativity, wisdom, and mindfulness — all core to productive focus.
- More distinctive in the productivity market (most tools default to blue).
- Retains enough blue-purple relationship that it reads as "professional" rather than "expressive."

### Icons: Lucide

- Consistent 1.5px stroke weight across all 1,400+ icons.
- The default icon library for shadcn/ui — zero additional setup.
- Line-based aesthetic matches Zenflow's structured minimalism.
- MIT licensed.

### Font: Geist

Vercel's Geist Sans + Geist Mono, purpose-built for digital product interfaces:
- Excellent legibility at 11–12px (task labels, timestamps).
- Geist Mono for all numerical data (times, durations, capacity figures).
- Both weights share proportions — they sit harmoniously in the same line.

### Border Radius: Small (0.375rem)

Between None (harsh) and Default (0.5rem, too playful). Small communicates structure and precision — the scheduling grid demands ordered geometry, not rounded softness.

---

## CSS Custom Properties

```css
/* ============================================================
   Zenflow Design Tokens — Stone Base, Violet Accent
   New York Style | Geist Font | Small Radius
   ============================================================ */

:root {
  --background:            oklch(0.99 0.002 106.5);
  --foreground:            oklch(0.153 0.006 107.1);
  --card:                  oklch(1 0 0);
  --card-foreground:       oklch(0.153 0.006 107.1);
  --popover:               oklch(1 0 0);
  --popover-foreground:    oklch(0.153 0.006 107.1);
  --primary:               oklch(0.496 0.265 301.924);
  --primary-foreground:    oklch(0.977 0.014 308.299);
  --secondary:             oklch(0.967 0.001 286.375);
  --secondary-foreground:  oklch(0.21 0.006 285.885);
  --muted:                 oklch(0.966 0.005 106.5);
  --muted-foreground:      oklch(0.58 0.031 107.3);
  --accent:                oklch(0.496 0.265 301.924);
  --accent-foreground:     oklch(0.977 0.014 308.299);
  --destructive:           oklch(0.577 0.245 27.325);
  --border:                oklch(0.93 0.007 106.5);
  --input:                 oklch(0.93 0.007 106.5);
  --ring:                  oklch(0.737 0.021 106.9);
  --radius:                0.375rem;
  --sidebar:               oklch(0.988 0.003 106.5);
  --sidebar-foreground:    oklch(0.153 0.006 107.1);
  --sidebar-primary:       oklch(0.558 0.288 302.321);
  --sidebar-primary-fg:    oklch(0.977 0.014 308.299);
  --sidebar-accent:        oklch(0.966 0.005 106.5);
  --sidebar-accent-fg:     oklch(0.228 0.013 107.4);
  --sidebar-border:        oklch(0.93 0.007 106.5);
  --sidebar-ring:          oklch(0.737 0.021 106.9);
}

.dark {
  --background:            oklch(0.153 0.006 107.1);
  --foreground:            oklch(0.988 0.003 106.5);
  --card:                  oklch(0.228 0.013 107.4);
  --card-foreground:       oklch(0.988 0.003 106.5);
  --popover:               oklch(0.228 0.013 107.4);
  --popover-foreground:    oklch(0.988 0.003 106.5);
  --primary:               oklch(0.438 0.218 303.724);
  --primary-foreground:    oklch(0.977 0.014 308.299);
  --secondary:             oklch(0.274 0.006 286.033);
  --secondary-foreground:  oklch(0.985 0 0);
  --muted:                 oklch(0.286 0.016 107.4);
  --muted-foreground:      oklch(0.737 0.021 106.9);
  --accent:                oklch(0.438 0.218 303.724);
  --accent-foreground:     oklch(0.977 0.014 308.299);
  --destructive:           oklch(0.704 0.191 22.216);
  --border:                oklch(1 0 0 / 10%);
  --input:                 oklch(1 0 0 / 15%);
  --ring:                  oklch(0.58 0.031 107.3);
  --sidebar:               oklch(0.228 0.013 107.4);
  --sidebar-foreground:    oklch(0.988 0.003 106.5);
  --sidebar-primary:       oklch(0.627 0.265 303.9);
  --sidebar-primary-fg:    oklch(0.977 0.014 308.299);
  --sidebar-accent:        oklch(0.286 0.016 107.4);
  --sidebar-accent-fg:     oklch(0.988 0.003 106.5);
  --sidebar-border:        oklch(1 0 0 / 10%);
  --sidebar-ring:          oklch(0.58 0.031 107.3);
}
```

---

## Typography Scale

| Role | Class Set | Usage |
|---|---|---|
| App heading | `text-xl font-semibold tracking-tight` | Page titles, panel headers |
| Section label | `text-[10px] font-bold uppercase tracking-wider text-muted-foreground` | Sidebar group labels |
| Body | `text-sm font-normal` | Form inputs, descriptions |
| Card title | `text-xs font-semibold` | Task card titles |
| Timestamp | `text-[10px] font-mono font-medium` | Times, durations |
| Micro label | `text-[9px] font-medium` | Tag chips, status badges |

Font stack: `'Geist', 'Geist Fallback', system-ui, sans-serif`
Mono stack: `'Geist Mono', 'Geist Mono Fallback', 'ui-monospace', monospace`

---

## Semantic Status Colors

These map to fixed task states. Do not use these colors for decoration.

| State | Light classes | Dark classes |
|---|---|---|
| Fluid / Scheduled | `bg-card border-l-primary` | same |
| Fixed / Anchor | `bg-muted border-dashed border-border` | same |
| Overdue | `bg-rose-50/40 border-l-rose-500 text-rose-950` | `bg-rose-950/10 border-l-rose-500 text-rose-100` |
| Conflict | `bg-amber-50/40 border-l-amber-500 text-amber-950` | `bg-amber-950/10 border-l-amber-500 text-amber-100` |
| Completed | `bg-muted border-l-emerald-500 opacity-60` | same |

---

## Component Rules

### Task Card

- Always uses `border-l-4` for the status left accent.
- Title: `text-xs font-semibold truncate`.
- Duration/time: `text-[10px] font-mono`.
- Tags: `text-[9px] font-medium bg-muted px-1.5 py-0.5 rounded border border-border`.
- Drag handle: visible on hover as `cursor-grab`; `cursor-grabbing` during drag.
- Fixed task: `border-dashed` + Lucide `lock` icon at `w-3 h-3 text-muted-foreground`.

### Time Grid

- Working hours: `bg-card` (white/dark) — full contrast, primary scheduling zone.
- Non-working hours: `bg-muted/40` (slightly dimmed) — still interactive; users can drop exception tasks here.
- Non-work days (Week/Month): column header dimmed, cells use `bg-muted/30` — droppable for exceptions.
- Hour grid lines: `border-b border-border`.
- "Now" indicator: `w-2 h-2 bg-destructive rounded-full` dot + `h-[2px] bg-gradient-to-r from-destructive via-destructive/40 to-transparent`.
- Non-working zones carry no `cursor-not-allowed` — they are valid drop targets. The EDF engine will never auto-place tasks there, but manual exceptions are fully supported.

### Sidebar

- Background: `bg-sidebar` / `border-r border-sidebar-border`.
- Width: `w-64` (256px) fixed.
- Section labels: `text-[10px] font-bold uppercase tracking-wider text-muted-foreground`.
- Progress bar: `bg-primary` fill on `bg-border` track, `h-1.5 rounded-full`.

### Header

- Height: `h-14` fixed.
- Background: `bg-card border-b border-border`.
- View toggle: `inline-flex bg-muted rounded-lg p-1 border border-border shadow-inner`.
- Active tab: `bg-card text-foreground shadow-sm border border-border`.
- Primary button: `bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-xs font-semibold px-4 h-9`.

### Focus Ring (New York)

```css
*:focus-visible {
  outline: 1px solid var(--ring);
  outline-offset: 0;
}
```

---

## Logo

The Zenflow "Zen Node" — a geometric mark representing structured flow.

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <!-- Outer grid frame -->
  <path d="M20 20H80V80H20V20Z" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" class="opacity-10"/>
  <!-- Grid tracks -->
  <line x1="40" y1="20" x2="40" y2="80" stroke="currentColor" stroke-width="2"
        stroke-dasharray="2 3" class="opacity-20"/>
  <line x1="60" y1="20" x2="60" y2="80" stroke="currentColor" stroke-width="2"
        stroke-dasharray="2 3" class="opacity-20"/>
  <!-- Flow paths -->
  <path d="M20 35H50C55.5 35 60 39.5 60 45V80" stroke="currentColor"
        stroke-width="3.5" stroke-linecap="round" class="opacity-40"/>
  <path d="M40 20V55C40 60.5 44.5 65 50 65H80" stroke="currentColor"
        stroke-width="3.5" stroke-linecap="round" class="opacity-70"/>
  <!-- Focal node — primary accent color -->
  <rect x="52" y="32" width="16" height="16" rx="4" fill="var(--primary)"/>
</svg>
```

---

## Icon Library: Lucide

Key icons used across the application:

| Purpose | Lucide icon name |
|---|---|
| Add task | `plus`, `plus-circle` |
| Calendar nav | `chevron-left`, `chevron-right` |
| Fixed/locked | `lock` |
| Completed | `circle-check` |
| Delete | `trash-2` |
| Settings | `settings` |
| Tags | `tag` |
| Drag handle | `grip-vertical` |
| Theme toggle | `sun`, `moon` |
| Close panel | `x` |
| Time | `clock` |
| Recurrence | `refresh-cw` |
| Conflict | `triangle-alert` |
