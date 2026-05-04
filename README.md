# Maison — Wardrobe Intelligence

A luxury wardrobe intelligence web application based on a PRD case study for Nita Ambani's wardrobe system (by Fynd). Single-file HTML/CSS/JS app with an editorial / magazine aesthetic.

## Design System

**Palette — Café Collection**
- Cinna `#CFB3A9` — primary accent
- Froth `#F1EEEB` — canvas / background
- Creme `#CDC6C3` — muted
- Latte `#A09086` — secondary accent
- Chai `#E4D8CB` — warm neutral
- Ink `#2B221D` — text / sidebar

**Typography**
- Fraunces (serif display, italic emphasis)
- Inter (body)
- JetBrains Mono (labels, meta)

**Motion**
- Spring easing `cubic-bezier(.22,.61,.36,1)`
- Subtle grain overlay via SVG turbulence filter

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `#page-home` | Hero, event countdown, curated ensembles, rediscover grid |
| Wardrobe | `#page-wardrobe` | Full collection with category filters, real images + SVG fallback |
| Stylist | `#page-builder` | 6-slot canvas — clicking any slot opens gallery picker modal |
| Try On | `#page-vto` | VEO-style loader → playable animated SVG figure colored from outfit |
| Calendar | `#page-calendar` | Month grid with event CRUD (add / edit / delete) |
| Lookbook | `#page-lookbook` | Nita Ambani archival looks from real events |
| Requests | `#page-requests` | Live pick list |
| Ops Dashboard | `#page-ops` | Tasks, inventory, request queue, activity feed |
| Ops Mobile | `#page-opsmobile` | Phone-frame camera intake simulation |

## Features

- Real fashion imagery from Unsplash CDN with SVG fallback per item type
- Clickable favourite hearts wired to cart badge with pop animation
- Gallery picker modal with category tabs + search
- Item detail modal with designer / fabric / year / wear history
- VTO animated figure with walk / turn / pose modes
- Calendar month nav, add-event form modal, hover-delete on events
- Ops Mobile: shutter → processing → metadata form → success popup → saves to `INVENTORY`

## State

All state is in-memory in the `state` object. `INVENTORY` array holds all items. Adding pieces via Ops Mobile mutates `INVENTORY` and updates all grids live.

## Ideas to continue in Claude Code

- Persist `INVENTORY` + events to `localStorage` or a real backend
- Replace the Ops Mobile SVG preview with real `getUserMedia` camera capture
- Split the single file into proper modules (React / Vite / etc.)
- Add user authentication and multi-user support (Madame + Ops roles)
- Wire the VTO to an actual VEO-like API for real video generation
- Implement the QR tracking + RFID loops from the PRD
- Add Algolia-style typeahead search
