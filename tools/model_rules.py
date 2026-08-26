"""Folding rules for machine models, brands and filter positions.

`model_key` and `tidy_model` are lifted from the DMS Invoicing app
(server/models.py) so the two apps agree on what counts as the same machine.
Everything else is new here: pulling the brand out of the model string, and
mapping four years of hand-typed filter descriptions onto a fixed set of
positions on the machine.
"""

import re

# ---------------------------------------------------------------------------
# Model identity  (model_key / tidy_model mirror ../DMS invoicing/app/server/models.py)
# ---------------------------------------------------------------------------


def model_key(model):
    """Matching key for a machine model.

    Display keeps readable spacing ('Kobelco SK140'); matching ignores spacing
    and case so 'U55-4', 'U 55-4' and 'u55 4' are one model.
    """
    return re.sub(r"[^A-Z0-9]", "", str(model or "").upper())


def tidy_model(model):
    """Readable machine model: collapse whitespace, drop trailing punctuation."""
    text = re.sub(r"\s+", " ", str(model or "")).strip()
    return text.strip(" /,-.") or None


def part_key(number):
    """Matching key for a part number: 'RC461-53962' == 'rc461 53962'."""
    return re.sub(r"[^A-Z0-9]", "", str(number or "").upper())


# ---------------------------------------------------------------------------
# Brands
# ---------------------------------------------------------------------------

# Brand words that appear inside the free-text model. Matched case-insensitively
# on a word boundary and then REMOVED, so 'Kobelco SK140' and a bare 'SK140'
# fold onto one model instead of two.
BRAND_WORDS = [
    ("Kubota",       [r"kubota", r"\bkbt\b"]),
    ("Hitachi",      [r"hitachi"]),
    ("Komatsu",      [r"komatsu"]),
    ("Yanmar",       [r"yanmar"]),
    ("Doosan",       [r"doosan"]),
    ("Kobelco",      [r"kobelco"]),
    ("Caterpillar",  [r"caterpillar", r"\bcat(?=\s*[-.]?\s*\d)", r"\bcat\b"]),
    ("Takeuchi",     [r"takeuchi"]),
    ("JCB",          [r"\bjcb\b"]),
    ("Bobcat",       [r"bobcat"]),
    ("Sumitomo",     [r"sumitomo"]),
    ("Sany",         [r"\bsany\b"]),
    ("Sunward",      [r"sunward", r"sanward"]),
    ("Hyundai",      [r"hyundai"]),
    ("Kioti",        [r"kioti", r"daedong"]),
    ("Eurocomach",   [r"eurocomak", r"eurocomach", r"hydrocomac"]),
    ("ASV",          [r"\basv\b"]),
    ("Toro",         [r"\btoro\b"]),
    ("John Deere",   [r"john deere", r"\bdeere\b", r"\bgator\b"]),
    ("Mitsubishi",   [r"mitsubishi", r"\bfuso\b"]),
    ("Behringer",    [r"behringer"]),
    ("Cosen",        [r"cosen"]),
]

# When no brand word is present, infer from how the model number itself starts.
# Ordered — first match wins. Deliberately generous: a wrong guess is cheap
# because the cleanup screen reassigns it, whereas 'Unassigned' hides a machine
# behind an extra tap forever.
BRAND_PREFIXES = [
    ("Kubota",      r"^(U\d|KX|KXO|SVL|L\d{3,4}|B\d{4}|BX\d|F\d{4}|G\d{4}|GR\d|ZD\d|RTV\d|T\d{4}|M\d{4})"),
    ("Hitachi",     r"^(ZX|EX|\d{2}U\d)"),
    ("Komatsu",     r"^(PC|PL\d|PCMR)"),
    ("Yanmar",      r"^(VIO|V\d{3})"),
    ("Doosan",      r"^DX\d"),
    ("Kobelco",     r"^(SK\d|SR\d)"),
    ("Caterpillar", r"^(3\d{2}|BC\d)"),
    ("Takeuchi",    r"^TB\d"),
    ("Sunward",     r"^(SWE|LWE)\d"),
    ("Sany",        r"^(SY\d|MDLSY)"),
    ("Sumitomo",    r"^SH\d"),
    ("Bobcat",      r"^S\d{3}$"),
    ("Eurocomach",  r"^ES\d"),
    ("Kioti",       r"^(CS\d|DK\d|CK\d)"),
    ("ASV",         r"^ASV"),
    ("JCB",         r"^JCB"),
]

UNASSIGNED = "Unassigned"

# Descriptive words that aren't part of the model number.
NOISE_WORDS = re.compile(
    r"\b(digger|excavator|tractor|lawn ?mower|mower|roller|compact|non cab|noncab)\b", re.I)

# Lead-ins the old invoice importer left glued to the front of a model.
LEAD_INS = re.compile(r"^\s*(model\s*[-:]?\s*|invoice\s+for\s+|fixing\s+|repairs?\s+(?:to|on|for)\s+)", re.I)

# Free prose that never contained a model at all.
PROSE_MARKERS = re.compile(
    r"\b(assist|pulled|travel issue|coolant leak|service charge|hours)\b", re.I)


def split_brand(raw):
    """('Kobelco SK140') -> ('Kobelco', 'SK140').

    Returns (brand, model_text). Brand is UNASSIGNED when nothing matches.
    """
    text = tidy_model(raw) or ""
    brand = None
    for name, patterns in BRAND_WORDS:
        for pattern in patterns:
            if re.search(pattern, text, re.I):
                brand = name
                text = re.sub(pattern, " ", text, flags=re.I)
                break
        if brand:
            break
    text = tidy_model(text) or ""
    if not brand:
        probe = model_key(text)
        for name, pattern in BRAND_PREFIXES:
            if re.match(pattern, probe):
                brand = name
                break
    return brand or UNASSIGNED, text


def clean_model(raw):
    """Recover a model from a free-text machines.model value.

    Returns (brand, display, key, hidden, reason). `hidden` marks rows that are
    invoice prose rather than machines; they are kept, not deleted, so the
    cleanup screen can show them.
    """
    text = tidy_model(raw) or ""
    original = text

    # 'Invoice for U55-4' -> 'U55-4'; 'Model - CAT 302' -> 'CAT 302'
    for _ in range(3):
        stripped = LEAD_INS.sub("", text)
        if stripped == text:
            break
        text = stripped
    text = tidy_model(text) or ""

    # 'Great Barrier Island Lawn Mower Repairs- BX2370' -> 'BX2370'
    if len(text.split()) > 3 and "-" in text:
        tail = tidy_model(text.rsplit("-", 1)[-1]) or ""
        if tail and len(tail.split()) <= 2 and re.search(r"[A-Za-z]", tail) \
                and re.search(r"\d", tail):
            text = tail

    brand, text = split_brand(text)
    text = tidy_model(NOISE_WORDS.sub(" ", text)) or ""

    # A row that is nothing but a brand ('Yanmar') is still a real machine —
    # the model just never got written down. Keep it visible and say so, rather
    # than hiding a machine dad actually services.
    if not text and brand != UNASSIGNED:
        return brand, "%s (model not recorded)" % brand, model_key(brand) + "UNSPEC", False, None

    hidden, reason = False, None
    if not text or not re.search(r"[A-Za-z0-9]", text):
        hidden, reason = True, "no model in the text"
    elif PROSE_MARKERS.search(original) and len(original.split()) > 3:
        hidden, reason = True, "looks like a note, not a machine"
    elif len(text.split()) > 3:
        hidden, reason = True, "too many words to be a model"

    # Hidden rows keep a key derived from what was actually typed, so a half
    # recovered fragment can never collide with a real model.
    if hidden:
        return brand, original, model_key(original), True, reason
    return brand, text, model_key(text), False, None


# ---------------------------------------------------------------------------
# Filter positions
# ---------------------------------------------------------------------------

# Not filters, even though 'filter' appears in the description.
NOT_A_FILTER = re.compile(r"\bkits?\b|o\W*ring|\bclips?\b|customer provided", re.I)

# Ordered: first match wins. 'Engine oil filter' must beat the generic oil rule,
# and 'AC Cab filter' must beat the generic air rule.
FILTER_SLOTS = [
    ("Cab / air-con filter",        r"\bcab\b|air ?con|\ba/?c\b"),
    ("Air filter — inner",          r"\binner\b"),
    ("Air filter — outer",          r"\bouter\b|\(out\)"),
    ("Engine oil filter",           r"(engine|en\s*/?\s*)\s*oil|^oil\b|\boil filter\b"),
    ("Fuel filter — water separator", r"water\s*(trap|sep)|separator|\bw\s*/\s*t\b"),
    ("Fuel filter — primary",       r"fuel.*primary|primary.*fuel"),
    ("Fuel filter — secondary",     r"fuel.*secondary|secondary.*fuel"),
    ("Fuel filter — inline",        r"inline.*fuel|fuel.*inline"),
    ("Fuel filter",                 r"\bfuel\b"),
    ("Hydraulic return filter",     r"(hy|hydraulic).*(return|re\s*/)|return"),
    ("Hydraulic suction filter",    r"suction"),
    ("Hydraulic case-drain filter", r"case ?drain"),
    ("Hydraulic inline filter",     r"(hy|hydraulic).*inline|^inline"),
    ("Pilot filter",                r"pilot"),
    ("HST filter",                  r"\bh\s*s\s*t\b"),
    ("Transmission filter",         r"\btrans"),
    ("Breather filter",             r"breather"),
    ("Air filter",                  r"\bair\b"),
    ("Hydraulic filter",            r"\bhy\b|hydraulic"),
]

# Display order on the kit screen — engine service items first, hydraulics after.
SLOT_ORDER = [
    "Engine oil filter",
    "Fuel filter",
    "Fuel filter — primary",
    "Fuel filter — secondary",
    "Fuel filter — water separator",
    "Fuel filter — inline",
    "Air filter",
    "Air filter — outer",
    "Air filter — inner",
    "Cab / air-con filter",
    "Hydraulic return filter",
    "Hydraulic suction filter",
    "Hydraulic case-drain filter",
    "Hydraulic inline filter",
    "Hydraulic filter",
    "Pilot filter",
    "HST filter",
    "Transmission filter",
    "Breather filter",
]


def filter_slot(description):
    """Map a hand-typed filter description onto a position on the machine.

    'Hitachi Air Filter Inner', 'Air filter inner' and 'KBT Air filter' are the
    same slot. Returns None when the description isn't a fitted filter.
    """
    text = str(description or "").strip()
    if not text or NOT_A_FILTER.search(text):
        return None
    for slot, pattern in FILTER_SLOTS:
        if re.search(pattern, text, re.I):
            return slot
    return None


def slot_sort(slot):
    try:
        return SLOT_ORDER.index(slot)
    except ValueError:
        return len(SLOT_ORDER)
