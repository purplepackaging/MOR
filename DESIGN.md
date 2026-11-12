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
| `--lilac` | `#f2ecfa` | Bands, panels, notes |
| `--tile` | `#ded2f1` | Product tiles only: deeper than the lilac around them, so white and clear products stand off |
| `--tile-2` | `#d2c3ec` | A tile under the pointer |
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
- Product photos are transparent cutouts on violet tiles (`--tile`), never on white boxes. A tile that holds
  a photo deepens toward its foot (12% of `--mor` laid over the tile), and the photo casts a soft shadow
  on it, sized to the tile, so white and clear products stand off it. A tile that holds a drawing stays flat.
  Tiles are square, except on a phone's product page, where the tile is a 3:2 band so the sizes start on
  the first screen.
- Every photo comes in two files: `name.webp` (1000 px on its long side, 600 at least) for the product
  page and `name-480.webp` for cards and lists. The build fails if either is missing.
- A product in a listing is a line on phones, like a line on the ticket: a 96 px tile, then the name and one
  line of detail. From 640 px it is a card: the tile over the name. The detail names the sizes for sale
  ("5 sizes: 9, 10, 12, 16, 24 oz"; a range above six sizes; the count alone when sizes are not one
  measure). A signed-in customer's price takes the last line, which is there for everyone, so nothing moves
  when it arrives. No borders, no hover lift, no shadow on the card.
- The product page, top to bottom: photo, name, one line with the material and the size range, pills for
  what every size shares, then the sizes. The sizes are the page: they open with a heading ("5 sizes"),
  "Sold by the case" and the heavy violet rule, and each row is a size, what a case holds and Add. On a
  phone at least two sizes show on the first screen.
- Rows say it the way a kitchen does: "1,000 per case", and "Lid size" on a cup (its "fits" in mm is the
  lid it takes). A list of seven sizes or more in two to five colors gets a color filter above it.
- "Goes with" names each product with a 64 px tile. Where the catalog says which of its sizes fit this
  product, those sizes follow, each with Add. It says only what the catalog says: a fit written in words
  is left out.
- The list bar: on a phone's product page, once the list has an item, a slip with the ticket's torn edge
  sits at the foot of the screen with the count and "View list". It stands on a line of brand violet and
  has no shadow. It confirms an Add, so the "Added" toast is spoken there and not shown.
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
- Product pages and cards say only what the catalog data says: no invented specs, uses or claims.
