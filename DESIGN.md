# MOR Supply design system

**Idea:** a standing order you never have to think about. MOR means "more on repeat": the O in the
wordmark is a loop, and the signature element is the order ticket, a white slip with perforated edges
like a kitchen printer ticket. Everything else stays quiet so products and the ticket carry the page.

## Color

| Token | Hex | Use |
| --- | --- | --- |
| `--ink` | `#23172e` | Text |
| `--ink-2` | `#554863` | Secondary text |
| `--mor` | `#5b2a86` | Brand violet: buttons, selected chips, steppers, links, quantities, heavy rules, focus |
| `--mor-deep` | `#2a1543` | Footer and toasts |
| `--lilac` | `#f2ecfa` | Product tiles, bands, panels |
| `--glow` | `#e2d1fa` | Soft violet light in the hero panel |
| `--lemon` | `#f3e36a` | Only for "on repeat" moments: delivery day pill, list count, rep badge |
| `--paper` | `#ffffff` | Page and ticket |

The order ticket keeps ink rules so it reads as a printed slip against the violet around it.

Errors use `--err` (`#a3241c`); success uses `--ok` (`#1d6b45`). All text pairs meet WCAG AA.

## Type

One family: **Readex Pro** (variable, self-hosted, Latin + Arabic), weights 380 body, 480 headings,
580 for quantities. Display sizes use tight tracking (-0.035em); Arabic resets tracking and gets more
line height. Numbers in tables and steppers are tabular.

## Layout

- Container 1240px with fluid gutters (16px on phones). Sections breathe: `--section` padding.
- Product photos are transparent cutouts on lilac square tiles, never on white boxes.
- Cards are plain: a tile, a name, one line of detail. No shadows, no borders, no hover lift.
- Shadows only on things that float: the ticket, the toast, menus.

## Rules

- Numbered markers only for real sequences (how ordering works, what happens next).
- No all-caps labels, no eyebrow text above headings, no single highlighted word in headlines.
- Buttons say what happens: "Add", "Send request", "Browse products".
- Motion only answers an action (add to list, open menu, toast). Nothing animates on scroll.
- Every interactive element has a 44px target and a visible focus ring.
