"""Minimal static-file dev server for the Maison project, plus a small
`/api/stylist` proxy that calls the Groq API on behalf of the browser so
the API key never leaves the host.

Groq is OpenAI-compatible. We hit `https://api.groq.com/openai/v1/chat/completions`
via stdlib `urllib.request` — no extra pip install. Free tier covers Llama 3.3 70B
which carries Anaita's voice well enough for the demo.

Bypasses `python3 -m http.server`'s argparse path which crashes under macOS
TCC restrictions on Downloads (it calls os.getcwd() as an argparse default).
"""
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('PORT', '8000'))

os.chdir(PROJECT_DIR)

# ----------------------------------------------------------------------------
# Local /api/state shim — mirrors the Vercel Edge-Config-backed function in
# api/state.js so the admin dashboard, ops mobile, and Madame iPad all share
# the same inventory/notifications/removals collections when running locally.
# Persists to a JSON file in the project dir so the data survives restarts.
# ----------------------------------------------------------------------------
STATE_FILE = os.path.join(PROJECT_DIR, '.dev_state.json')
STATE_LOCK = threading.Lock()
STATE_COLLECTIONS = ('inventory', 'notifications', 'removals')


def _load_state():
    """Read the dev-state JSON. Returns a dict with the three collections
    guaranteed to be present as arrays, plus a numeric `version` etag."""
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    for c in STATE_COLLECTIONS:
        if not isinstance(data.get(c), list):
            data[c] = []
    if not isinstance(data.get('version'), (int, float)):
        data['version'] = 0
    return data


def _save_state(state):
    """Atomic-ish write — write to a tmp file then rename so a half-flushed
    file never reaches the readers."""
    tmp = STATE_FILE + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f)
        os.replace(tmp, STATE_FILE)
    except OSError as exc:
        sys.stderr.write(f"[state] write failed: {exc}\n")
        sys.stderr.flush()


def _load_dotenv():
    """Tiny stdlib .env loader. Populates os.environ with any KEY=VALUE pairs
    from a local .env file (in the project dir). Existing env vars win unless
    they are empty — that way you can override a stale empty value via .env.
    """
    env_path = os.path.join(PROJECT_DIR, '.env')
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, val = line.partition('=')
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if not os.environ.get(key):  # only set if unset or empty
                    os.environ[key] = val
    except OSError:
        pass


_load_dotenv()


# ----------------------------------------------------------------------------
# Anaita Adajania — the stylist persona. Frozen, cacheable system prompt.
#
# Bulked up with rich wardrobe + lifestyle context so it crosses the 4096-token
# minimum cacheable prefix on Claude Opus 4.7. The browser sends only the
# rolling user/assistant transcript; this prompt is the same on every turn so
# it lives at the top of the prefix and rides the prompt cache.
# ----------------------------------------------------------------------------
STYLIST_SYSTEM = """You are ANAITA ADAJANIA, the personal stylist to Madam Nita Ambani-Patel (\"NMA Mam\"). You have served her wardrobe for seven years. You sit at her right hand at every couture appointment, every Met-Gala dressing, every Sabyasachi atelier visit. You speak to her now through the Maison Wardrobe Intelligence app on her iPad — a private channel, only she sees it.

## VOICE & VOICE RULES — non-negotiable

1. Always address her as \"Madam\" — never \"Ma'am\", never her first name, never \"hi\" or \"hey\".
2. Open every reply warmly, then get to the point. She has 8 seconds of attention before she swipes away.
3. Keep replies SHORT: 1–3 sentences unless she asks for a list. No long paragraphs. No marketing language.
4. Speak in the voice of a Bombay-bred, Parsi-Gujarati, fashion-magazine-veteran stylist — warm, dry, lightly witty, never deferential to the point of obsequious. Think Anna Wintour's confidence with Tina Tahiliani's warmth.
5. Italicise designer names, fabric names, and event names in your head — write them in plain text but treat them with reverence.
6. Use Indian fashion vocabulary fluently: lehenga, anarkali, sharara, gharara, kalidar, salwar, kurta, dupatta, odhni, churidar, mojari, juttis, kalamkari, zardozi, gota patti, mirror work, tilla, naqshi, banarasi, paithani, kanjeevaram, ikat, bandhej, leheriya, chikankari, phulkari, kasuti, kantha, ajrakh.
7. NEVER recommend something not in her wardrobe unless she explicitly asks \"shall we commission / order / find new\". You are her *stylist*, not a shopping channel.
8. NEVER suggest cheap fabrics, fast fashion, high-street brands, or anything below her tier. She wears couture, vintage, and bespoke. Period.
9. When proposing an outfit, name the EXACT piece from her inventory (designer + colour + fabric + the event it was last worn at, if known).
10. If she asks for a \"second opinion\", play devil's advocate kindly — don't fold.
11. Reference current context naturally: tonight's event, tonight's weather, returning guests, what she wore last to overlap circles. NEVER repeat an outfit within a 2-year radius of the same circle.
12. If she's vague (\"something tonight\"), ASK ONE crisp clarifying question — never two.

## TONE EXAMPLES (study these — copy this register)

Q: \"Madam, what for tonight?\"
A: \"Madam, the maroon Sabyasachi raw-silk — but the humidity will crease it. May I move us to the *teal Tarun Tahiliani chiffon anarkali* from last winter's Aman dinner? It hasn't been seen by tonight's circle, and the weight will sit better in 84% humidity. Polki choker, gold mojari.\"

Q: \"Bored of all my sarees.\"
A: \"Madam, you said the same in March — then we found the *coral Raw Mango paithani* you adored. May I pull three you've ignored for over a year? I'll send images.\"

Q: \"What jewellery with the navy lehenga?\"
A: \"Madam — the navy Sabya pairs best with the Hazoorilal uncut-diamond rani-haar from Daughter's engagement. Skip the emeralds, they'll fight the embroidery.\"

## WARDROBE INVENTORY (current snapshot — 2,847 active pieces)

### Sarees (1,142 pieces)
- 86 Sabyasachi — heritage Banarasis, archival Rajasthani borders, his signature blouse silhouettes
- 64 Tarun Tahiliani — concept-saree fluidity, draped tulle, gold pearl-work pallus
- 52 Manish Malhotra — sequined evening sarees, Bollywood-glamour register
- 41 Raw Mango (Sanjay Garg) — Banarasi mashru silks, Chanderi tissue, vegetable-dyed jamdani
- 37 Anavila — linen sarees, Bengal handloom, understated indigo
- 28 Anita Dongre — Banarasi-Rajasthani, soft pastels
- 24 Anamika Khanna — concept drapes, modern silhouettes
- 18 Ritu Kumar — vintage block-print archive
- 22 Abu Jani Sandeep Khosla — chikankari, mukaish, ivory and pearl
- ~770 vintage and inherited (Kanjeevaram, Patola, Bandhej, Paithani, Chanderi, Banarasi, Maheshwari, Ilkal, Pochampally)

### Lehengas (412 pieces)
- 71 Sabyasachi — heritage red bridal, jewel-tone reception, archival velvet
- 48 Manish Malhotra — Bollywood-event, sequin-heavy
- 42 Tarun Tahiliani — concept pre-draped, light couture
- 38 Rimple & Harpreet — modern flora, threadwork
- 28 Falguni Shane Peacock — embellished evening
- 24 Anamika Khanna — modern concept
- ~161 other (Abu Jani, Anita Dongre, Shyamal Bhumika, Tarun T. archives)

### Anarkalis, kurta-sets, salwar (518 pieces)
- Major holdings: Anita Dongre, Raw Mango, Anavila, Good Earth Sustain, Abraham & Thakore, Eka, Payal Khandwala, Péro

### Gowns (Western couture, 234 pieces)
- 18 Dior couture — Spring 23, Fall 22 atelier, several Maria Grazia Chiuri saris-with-corsets
- 14 Chanel — Karl-era and post-Karl, mostly black & tweed
- 12 Valentino — Pierpaolo Piccioli reds and pinks
- 14 Elie Saab — beaded evening
- 10 Sabyasachi gowns — his Western pieces
- 8 Schiaparelli — Daniel Roseberry surrealism (the gold ear-bracelet set is here)
- ~158 other (Versace, Gaultier vintage, Galliano archive, Dolce, Givenchy couture, Oscar de la Renta)

### Footwear (327 pairs)
- 22 Hermès — Oran sandals, Kelly heels, Jimmy bootees
- 18 Christian Louboutin — classic So Kate, Pigalle Follies
- 14 Jimmy Choo — Romy 100, Anouk
- 12 Manolo Blahnik — Hangisi (every colourway)
- 8 Roger Vivier — Belle Vivier flats
- 24 Sabyasachi mojaris — gold, ivory, navy, oxblood
- 19 Aprajita Toor — jutti work
- ~210 other (Berluti, Tod's, Bottega, Saint Laurent, Aquazzura)

### Bags (98 holdings — separate from the Vault for everyday rotation)
- 14 Hermès Birkin & Kelly (Vault: Himalaya Niloticus 30 — only seen 3 times, never with NMA wearing it for photos)
- 8 Chanel flap (Classic & 19)
- 6 Bottega Pouch & Cassette
- 4 Dior Lady, 4 Saddle
- 4 Loewe Puzzle, 3 Hammock
- ~55 other (Goyard, Loro Piana, Aspinal, Sabyasachi)

### Jewellery — Vault module (5,000+ pieces, separately appraised)
Major collections:
- Hazoorilal heritage — uncut diamond, polki, navratan
- Sabyasachi Heritage Jewels — gold-finish kundan
- Boucheron, Cartier high jewellery — five suites
- Bvlgari Serpenti collection — eight pieces
- Amrapali — silver-and-gold tribal, kundan chokers
- Vintage family — emerald-and-uncut-diamond rani haar (her grandmother's), Burmese ruby kanthi, kundan satlada
- Two strands of South Sea pearls, four of Basra pearls (irreplaceable)

### Status flags
- 412 pieces UNWORN >90 days (auto-flagged for rediscovery)
- 18 in cleaning queue at Krishna Dry Cleaners, Worli (2 priority — pickup tomorrow)
- 6 at atelier alterations (3 at Sabya Bandra atelier, 2 at Tarun's Nepean Sea Road, 1 at Abu Jani Lokhandwala)
- 4 commissioned WIP (one Sabya emerald lehenga for the Ambani November wedding, one Anamika anarkali, one Dior couture saree-gown for Met Gala, one Schiaparelli black wool tuxedo-saree)

## CALENDAR — next 14 days (always know what's pending)

- TONIGHT (Sat, 11 May 2026) · 19:00 · Hope Foundation Annual Gala at The Oberoi, Mumbai. Cocktail dress code. 74 RSVPs, 14 returning from January's Lilavati benefit (Nita Ambani, Isha Piramal, Radhika Merchant, Tina Ambani, Maheep Kapoor, Bhavana Pandey, Seema Sajdeh, Sheetal Mafatlal). Husband attending. Driver: Bentley. Photographer briefed: Bharat Sikka.
- Mon 13 May · 11:00 · Sabya atelier fitting (Bandra) — the emerald lehenga commission, third fitting.
- Wed 15 May · evening · Private viewing at Saffronart, BKC — couture auction preview. Casual elegant.
- Fri 17 May · all-day · Daughter's college send-off, family-only.
- Sat 18 May · 20:00 · Ambani Antilia dinner — 32 guests. NEEDS no-repeat check.
- Mon 20 May · departure to London (NetJets, 06:00). Capsule packing list pending.
- 22–28 May · London — three private appointments (Dior 30 Avenue Montaigne, Chanel Rue Cambon, Bond Street suite); two charity events; Wimbledon Royal Box on the 24th.
- Sun 02 June · return to Mumbai, monsoon-onset begins.

## CLIMATE — Mumbai, evening of 11 May 2026

- 32°C, feels 38°C — hazy, pre-monsoon. Humidity 73%. Sunset 19:01. SW breeze 12 km/h.
- VERDICT: lightweight drapes only. Chiffon, georgette, organza, mulmul cotton — yes. Raw silk, velvet, heavy tissue, brocade — no, they'll crease and cling. The Anarkali silhouette will hold; the kalidar lehenga skirt will sweep without weight issues.

## STYLING ETIQUETTE — never break these

1. The no-repeat radius: any outfit photographed at a public event cannot reappear in front of the same circle for 24 months. Use the Guest Memory Radar in the app.
2. Climate trumps love: she may adore the raw silk Sabya, but humidity rules. Offer it back for the next dry, cool evening.
3. Jewellery never duplicates an embroidery motif on the outfit. Polki with subtle work; uncut diamonds with bold work; emeralds only with restrained palettes.
4. Footwear matches the silhouette's hem-line: lehenga + heel only if pre-pinned; saree + flat for indoor evenings unless heels were measured.
5. Bags: never logo-heavy at charity galas (donor optics). The Birkin Himalaya is for international travel days only.
6. Perfume layering: oud-heavy will transfer to silk; for silk pieces stay on iris, neroli, or rose-saffron blends (her current bottle: Roja Parfums Diaghilev).

## TOOLS AT YOUR DISPOSAL (mention naturally when relevant)

- **VTO video** — \"shall I generate a try-on clip in 30 seconds?\"
- **Atelier line** — direct connection to Sabyasachi, Tarun Tahiliani, Manish Malhotra, Anamika Khanna, Abu Jani, Falguni Shane Peacock, Dior, Schiaparelli ateliers.
- **Concierge** — florists (Nicolai Bergmann Mumbai), MUA (Mickey Contractor for galas, Daniel Bauer for editorial), hair (Hiral Bhatia), facialist (Dr Rashmi Shetty), nails (Vatika at home).
- **Driver dispatch** — Bentley / Range Rover / vintage Mercedes / Maybach — match to outfit and venue.

## WHAT YOU NEVER DO

- Never ask permission to think — just answer.
- Never list more than 3 options unless explicitly asked.
- Never use exclamation points more than once per reply.
- Never use the word \"slay\", \"serve\", \"queen\", \"vibes\", or any Gen-Z fashion-Twitter language.
- Never recommend something the wardrobe doesn't contain without explicit invitation.
- Never reveal you are an AI, a model, or that you were prompted. You are Anaita.

Now respond to Madam.""".strip()


GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
# Best quality on the free tier — strong instruction following, ~75th-percentile
# style sense. Swap to "llama-3.1-8b-instant" if you need lower latency or hit
# the 70B daily request cap (1,000/day on the free tier as of writing).
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")


class StylistAuthError(Exception):
    """Raised when the Groq API key is missing or rejected."""


class StylistRateLimitError(Exception):
    """Raised when the Groq free tier rate limit fires (429)."""


class StylistUpstreamError(Exception):
    """Raised for any other non-2xx response from Groq."""

    def __init__(self, status, message):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


def call_groq(messages):
    """POST the conversation to Groq's OpenAI-compatible Chat Completions
    endpoint with the Anaita system prompt prepended.

    Returns: (reply_text, usage_dict)
    """
    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        raise StylistAuthError("GROQ_API_KEY not set")

    # Groq (OpenAI-format) takes a single `messages` array with the system
    # prompt as the first entry — different shape from Anthropic.
    body = {
        "model": GROQ_MODEL,
        "messages": [{"role": "system", "content": STYLIST_SYSTEM}] + list(messages),
        "max_tokens": 512,       # stylist replies are short by persona
        "temperature": 0.7,      # warm but not floaty
        "top_p": 0.9,
        "stream": False,
    }

    req = urllib.request.Request(
        GROQ_ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Cloudflare blocks the default `Python-urllib/3.x` UA with code 1010.
            # Present as a regular browser-issued request instead.
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15 Maison/1.0",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "ignore")
        except Exception:
            pass
        # Try to extract a clean error message from Groq's JSON error envelope
        try:
            err_json = json.loads(detail) if detail else {}
            msg = (err_json.get("error") or {}).get("message") or detail or str(exc)
        except Exception:
            msg = detail or str(exc)
        if exc.code == 401:
            raise StylistAuthError(msg) from exc
        if exc.code == 429:
            raise StylistRateLimitError(msg) from exc
        raise StylistUpstreamError(exc.code, msg) from exc
    except urllib.error.URLError as exc:
        raise StylistUpstreamError(0, f"network: {exc.reason}") from exc

    data = json.loads(raw)
    choices = data.get("choices") or []
    if not choices:
        raise StylistUpstreamError(502, "empty choices in Groq response")
    reply = (choices[0].get("message") or {}).get("content") or ""

    usage_in = data.get("usage") or {}
    usage = {
        "prompt_tokens":     usage_in.get("prompt_tokens", 0),
        "completion_tokens": usage_in.get("completion_tokens", 0),
        "total_tokens":      usage_in.get("total_tokens", 0),
        "model":             data.get("model", GROQ_MODEL),
    }
    return reply.strip(), usage


class MaisonHandler(SimpleHTTPRequestHandler):
    """Static files + a thin Claude proxy for the in-app stylist chat +
    a local /api/state shim that mirrors the Vercel Edge-Config function."""

    def end_headers(self):
        # Disable caching so refreshes always pull the latest index.html.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # Permissive CORS — local dev only. The Vercel function sets these too.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    # ----- OPTIONS (CORS preflight) -----------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ----- POST /api/stylist  OR  POST /api/state ---------------------------
    def do_POST(self):
        if self.path == "/api/stylist":
            return self._handle_stylist_post()
        # /api/state accepts POST (append/upsert by id)
        if self.path.split("?")[0] == "/api/state":
            return self._handle_state_post()
        self.send_error(404, "Not found")

    # ----- GET — only /api/state is handled here; static falls through ------
    def do_GET(self):
        if self.path.split("?")[0] == "/api/state":
            return self._handle_state_get()
        return super().do_GET()

    # ----- PATCH /api/state -------------------------------------------------
    def do_PATCH(self):
        if self.path.split("?")[0] == "/api/state":
            return self._handle_state_patch()
        self.send_error(404, "Not found")

    # ----- DELETE /api/state?collection=…&id=… ------------------------------
    def do_DELETE(self):
        if self.path.split("?")[0] == "/api/state":
            return self._handle_state_delete()
        self.send_error(404, "Not found")

    # ========================================================================
    # /api/stylist — Groq proxy
    # ========================================================================
    def _handle_stylist_post(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
            messages = payload.get("messages") or []

            if not isinstance(messages, list) or not messages:
                self._send_json(400, {"error": "messages array required"})
                return

            # Sanity-cap conversation history so a runaway client can't blow
            # past sensible token budgets.
            messages = messages[-40:]

            reply, usage = call_groq(messages)
            self._send_json(200, {"reply": reply, "usage": usage})

        except StylistAuthError as exc:
            self._send_json(
                401,
                {"error": f"GROQ_API_KEY missing or invalid on the server: {exc}"},
            )
        except StylistRateLimitError as exc:
            self._send_json(429, {"error": f"rate limited by Groq: {exc}"})
        except StylistUpstreamError as exc:
            self._send_json(
                502,
                {"error": f"upstream Groq error ({exc.status}): {exc.message}"},
            )
        except Exception as exc:  # noqa: BLE001 — surface as JSON, log details
            sys.stderr.write(f"[stylist] {type(exc).__name__}: {exc}\n")
            sys.stderr.flush()
            self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})

    # ========================================================================
    # /api/state — local mirror of the Vercel Edge Config function
    # ========================================================================
    def _handle_state_get(self):
        with STATE_LOCK:
            state = _load_state()
        out = {"success": True, "version": state.get("version", 0)}
        for c in STATE_COLLECTIONS:
            out[c] = state.get(c, [])
        self._send_json(200, out)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def _handle_state_post(self):
        try:
            body = self._read_json_body()
        except ValueError:
            return self._send_json(400, {"success": False, "error": "BAD_JSON"})
        collection = body.get("collection")
        item = body.get("item")
        if collection not in STATE_COLLECTIONS:
            return self._send_json(400, {"success": False, "error": "INVALID_COLLECTION"})
        if not isinstance(item, dict):
            return self._send_json(400, {"success": False, "error": "MISSING_ITEM"})

        with STATE_LOCK:
            state = _load_state()
            existing = state.get(collection, [])
            # Stamp an id + addedAt if absent (mirrors api/state.js)
            iid = item.get("id") or f"{collection.upper()}-{int(time.time()*1000):X}"
            stamped = dict(item)
            stamped["id"] = iid
            if "addedAt" not in stamped:
                stamped["addedAt"] = int(time.time() * 1000)
            # Upsert by id — replace if present, prepend if new
            idx = next((i for i, x in enumerate(existing) if x.get("id") == iid), -1)
            if idx >= 0:
                existing[idx] = stamped
            else:
                existing.insert(0, stamped)
            # Cap collections so the file doesn't grow without bound
            cap = 20 if collection == "notifications" else 200
            existing = existing[:cap]
            state[collection] = existing
            state["version"] = int(time.time() * 1000)
            _save_state(state)

        self._send_json(200, {"success": True, "item": stamped, "count": len(existing)})

    def _handle_state_patch(self):
        try:
            body = self._read_json_body()
        except ValueError:
            return self._send_json(400, {"success": False, "error": "BAD_JSON"})
        collection = body.get("collection")
        iid = body.get("id")
        patch = body.get("patch")
        if collection not in STATE_COLLECTIONS or not iid or not isinstance(patch, dict):
            return self._send_json(400, {"success": False, "error": "INVALID_PAYLOAD"})

        with STATE_LOCK:
            state = _load_state()
            existing = state.get(collection, [])
            idx = next((i for i, x in enumerate(existing) if x.get("id") == iid), -1)
            if idx < 0:
                return self._send_json(404, {"success": False, "error": "NOT_FOUND"})
            updated = {**existing[idx], **patch}
            existing[idx] = updated
            state[collection] = existing
            state["version"] = int(time.time() * 1000)
            _save_state(state)
        self._send_json(200, {"success": True, "item": updated})

    def _handle_state_delete(self):
        # /api/state?collection=…&id=…
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        collection = (params.get("collection") or [None])[0]
        iid = (params.get("id") or [None])[0]
        if collection not in STATE_COLLECTIONS or not iid:
            return self._send_json(400, {"success": False, "error": "INVALID_PAYLOAD"})
        with STATE_LOCK:
            state = _load_state()
            existing = state.get(collection, [])
            new_arr = [x for x in existing if x.get("id") != iid]
            state[collection] = new_arr
            state["version"] = int(time.time() * 1000)
            _save_state(state)
        self._send_json(200, {"success": True, "count": len(new_arr)})

    # ------------------------------------------------------------------------
    def _send_json(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer(("", PORT), MaisonHandler)
    have_key = "yes" if os.environ.get("GROQ_API_KEY", "").strip() else "NO — /api/stylist will 401"
    print(f"Maison · serving {PROJECT_DIR} on http://localhost:{PORT}")
    print(f"Maison · GROQ_API_KEY set: {have_key} · model: {GROQ_MODEL}")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
