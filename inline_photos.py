#!/usr/bin/env python3
"""
inline_photos.py — embed every image in img/ into index.html as base64.

Usage:
  1. Save any garment photo as img/<ITEM_ID>.<ext>
     Supported extensions: .png .jpg .jpeg .webp (case-insensitive)
     Example: img/M1002.png, img/J2001.jpg
  2. Run: python3 inline_photos.py
  3. Hard-refresh the browser — all items now show your real photos.

Valid item IDs (must match exactly):
  M1001  Midnight Silk Gown             (Sabyasachi)
  M1002  Maroon Banarasi                (Sabyasachi)
  M1003  Emerald Flare Gown             (Tarun Tahiliani)
  M1004  Ivory Gold Lehenga             (Manish Malhotra)
  M1005  Ruby Patola Saree              (Raw Mango)
  M1006  Cream Chikankari Suit          (Anita Dongre)
  M1007  Blush Pink Lehenga             (Sabyasachi)
  M1008  Midnight Black Gown            (Anamika Khanna)
  M1009  Royal Blue Banarasi            (Sabyasachi)
  --- Named wardrobe (save as img/<ID>.png) ---
  M-SAREE-EVENING / M-SAREE-FESTIVE / M-SAREE-HERITAGE
  M-SAREE-EDITORIAL / M-SAREE-SIGNATURE / M-SAREE-CLASSIC
  M-LEHENGA-WEDDING / M-LEHENGA-FESTIVE / M-LEHENGA-EDITORIAL
  M-LEHENGA-HERITAGE / M-LEHENGA-SIGNATURE
  M-GOWN-EVENING / M-GOWN-EDITORIAL / M-GOWN-CLASSIC
  M-GOWN-SIGNATURE / M-GOWN-RARE
  M-ANARKALI-FESTIVE / M-ANARKALI-EDITORIAL
  M-ANARKALI-HERITAGE / M-ANARKALI-SIGNATURE
  M-CLUTCH-EVENING / M-CLUTCH-EDITORIAL / M-CLUTCH-HERITAGE
  M-HEELS-EVENING / M-HEELS-SIGNATURE / M-JUTTIS-FESTIVE
  M-EARRINGS-EVENING / M-EARRINGS-HERITAGE
  M-EARRINGS-SIGNATURE / M-NECKLACE-EDITORIAL
  J2001  Chandelier Earrings            (Hazoorilal)
  J2002  Polki Diamond Set              (Amrapali)
  J2003  Gold Bangle Set                (Tanishq)
  J2004  Jhumka Earrings                (Kishandas)
  B3001  Brocade Potli                  (Bhanvara)
  B3002  Crystal Minaudière             (Judith Leiber)
  F4001  Crystal-Strap Heels            (Jimmy Choo)
  F4002  Gold Juttis                    (Needledust)
  LB1-LB9  Lookbook archival looks
"""
import base64
import pathlib
import re
import sys

PROJ = pathlib.Path(__file__).resolve().parent
IMG_DIR = PROJ / 'img'
INDEX = PROJ / 'index.html'

MIME = {'png': 'image/png', 'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg', 'webp': 'image/webp'}
ID_RE = re.compile(r'^(M\d+|J\d+|B\d+|F\d+|LB\d+|M-[A-Z]+-[A-Z]+)$')


def main():
    if not IMG_DIR.is_dir():
        print(f'img/ not found at {IMG_DIR}', file=sys.stderr)
        sys.exit(1)
    html = INDEX.read_text()
    m = re.search(r'const PHOTO_MAP = \{([\s\S]*?)\};', html)
    if not m:
        print('ERROR: PHOTO_MAP block not found in index.html', file=sys.stderr)
        sys.exit(1)

    entries = []
    skipped = []
    for f in sorted(IMG_DIR.iterdir()):
        if not f.is_file() or f.name.startswith('.'):
            continue
        ext = f.suffix.lower().lstrip('.')
        if ext not in MIME:
            skipped.append((f.name, 'unsupported extension'))
            continue
        if not ID_RE.match(f.stem):
            skipped.append((f.name, 'filename must be <ITEM_ID>.<ext>'))
            continue
        data = f.read_bytes()
        b64 = base64.b64encode(data).decode('ascii')
        entries.append((f.stem, f'data:{MIME[ext]};base64,{b64}', len(data)))

    new_block = (
        '\n  // Auto-populated by inline_photos.py — run that script to refresh\n'
        + ''.join(f"  '{eid}':'{url}',\n" for eid, url, _ in entries)
    )
    updated = html[:m.start(1)] + new_block + html[m.end(1):]
    INDEX.write_text(updated)

    print(f'Embedded {len(entries)} image(s):')
    for eid, _, sz in entries:
        print(f'  {eid:6s}  {sz/1024:>7.1f} KB')
    if skipped:
        print('\nSkipped:')
        for name, why in skipped:
            print(f'  {name}  —  {why}')
    print(f'\nindex.html updated ({len(updated)/1024:.0f} KB)')
    print('Hard-refresh the browser to see the new photos.')


if __name__ == '__main__':
    main()
