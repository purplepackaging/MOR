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
| `--lilac-2` | `#e6dcf6` | A tile under the pointer |
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
- Product photos are transparent cutouts on lilac square tiles, never on white boxes. A tile that holds
  a photo deepens toward its foot (8% of `--mor` laid over the tile), and the photo casts a soft shadow
  on it, sized to the tile, so white and clear products stand off it. A tile that holds a drawing stays flat.
- Every photo comes in two files: `name.webp` (1000 px on its long side, 600 at least) for the product
  page and `name-480.webp` for cards and lists. The build fails if either is missing.
- Cards are plain: a tile, a name, one line of detail. No borders, no hover lift, no shadow on the card.
- Shadows only on things that float (the ticket, the toast, menus) and under a product photo. A photo's shadow is
  drawn on a layer that covers the tile, never on the image (Safari clips it at the image's edge).
- Clear and white products show as photographed on white: their insides are opaque, so the tile never shows
  through a clear bowl.

## Rules

- Numbered markers only for real sequences (how ordering works, what happens next).
- No all-caps labels, no eyebrow text above headings, no single highlighted word in headlines.
- Buttons say what happens: "Add", "Send request", "Browse products".
- Motion only answers an action (add to list, open menu, toast). Nothing animates on scroll.
- Every interactive element has a 44px target and a visible focus ring.
