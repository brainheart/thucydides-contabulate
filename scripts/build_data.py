#!/usr/bin/env python3
"""Build static data files for the Thucydides contabulate app."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "docs" / "data"
LINES_DIR = ROOT / "docs" / "lines"
TEI_NS = "http://www.tei-c.org/ns/1.0"
NS = {"tei": TEI_NS}
TOKEN_RE = re.compile(r"[^\W\d_]+(?:[᾽'][^\W\d_]+)?", re.UNICODE)

GREEK_BOOK_LETTERS = [
    "α", "β", "γ", "δ", "ε", "ζ", "η", "θ",
]

WORK_SPEC = {
    "title": "History of the Peloponnesian War",
    "display_title": "Ἱστορίαι",
    "abbr": "Thuc.",
    "source": ROOT / "source_text" / "thucydides.xml",
    "play_id": 1,
    "sort_prefix": "01",
}


def tokenize(text: str) -> list[str]:
    return [match.group(0).lower() for match in TOKEN_RE.finditer(text or "")]


def ngrams(tokens: list[str], n: int) -> list[str]:
    return [" ".join(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, separators=(",", ":"), ensure_ascii=False)


def dedup_postings(index: dict[str, list[list[int]]]) -> dict[str, list[list[int]]]:
    result: dict[str, list[list[int]]] = {}
    for term, postings in index.items():
        merged: dict[int, int] = {}
        for chunk_id, count in postings:
            merged[chunk_id] = merged.get(chunk_id, 0) + count
        result[term] = [[chunk_id, count] for chunk_id, count in sorted(merged.items())]
    return result


def build_character_indexes(characters: list[dict]) -> tuple[dict, dict, dict]:
    tokens1 = defaultdict(list)
    tokens2 = defaultdict(list)
    tokens3 = defaultdict(list)

    for character in characters:
        character_id = character["character_id"]
        name_tokens = tokenize(f"{character['play_title']} {character['name']}")
        counts1 = Counter(name_tokens)
        counts2 = Counter(ngrams(name_tokens, 2))
        counts3 = Counter(ngrams(name_tokens, 3))

        for term, count in counts1.items():
            tokens1[term].append([character_id, count])
        for term, count in counts2.items():
            tokens2[term].append([character_id, count])
        for term, count in counts3.items():
            tokens3[term].append([character_id, count])

    return dedup_postings(tokens1), dedup_postings(tokens2), dedup_postings(tokens3)


def text_content(elem: ET.Element) -> str:
    return " ".join("".join(elem.itertext()).split())


def section_refs(book_div: ET.Element):
    """Yield (chapter_n, section_n, section_element) in citation order."""
    chapter_n = None
    for elem in book_div.iter():
        if elem is book_div:
            continue
        if elem.tag != f"{{{TEI_NS}}}div":
            continue
        subtype = (elem.attrib.get("subtype") or "").lower()
        n = (elem.attrib.get("n") or "").strip()
        if subtype == "chapter":
            chapter_n = int(n) if n.isdigit() else None
        elif subtype == "section" and chapter_n is not None and n.isdigit():
            yield chapter_n, int(n), elem


def build() -> None:
    spec = WORK_SPEC
    tree = ET.parse(spec["source"])
    root = tree.getroot()
    body = root.find(".//tei:body", NS)
    if body is None:
        raise ValueError(f"No <body> found in {spec['source']}")

    book_divs = []
    for div in body.findall(".//tei:div", NS):
        n = (div.attrib.get("n") or "").strip()
        subtype = (div.attrib.get("subtype") or "").lower()
        typ = (div.attrib.get("type") or "").lower()
        if n.isdigit() and (subtype == "book" or typ == "textpart"):
            # Restrict to top-level books; nested chapters/sections are also textparts.
            if subtype == "book":
                book_divs.append(div)

    book_divs.sort(key=lambda div: int(div.attrib["n"]))
    if not book_divs:
        raise ValueError(f"No book divs found in {spec['source']}")

    plays = []
    characters = []
    chunks = []
    all_lines = []
    tokens1 = defaultdict(list)
    tokens2 = defaultdict(list)
    tokens3 = defaultdict(list)
    act_totals = Counter()
    act_section_totals = Counter()

    chunk_id = 0
    character_id = 0
    work_total_words = 0
    work_total_sections = 0

    for book_div in book_divs:
        book_n = int(book_div.attrib["n"])
        book_letter = GREEK_BOOK_LETTERS[book_n - 1] if 1 <= book_n <= len(GREEK_BOOK_LETTERS) else str(book_n)
        book_label = f"Βιβλίον {book_letter}"
        character_id += 1
        characters.append({
            "character_id": character_id,
            "play_id": spec["play_id"],
            "play_title": spec["title"],
            "name": book_label,
            "gender": "A",
            "num_speeches": 0,
            "total_words_spoken": 0,
            "act_label": book_label,
            "num_lines": 0,
            "book_number": book_n,
        })

        for chapter_n, section_n, section_elem in section_refs(book_div):
            text = text_content(section_elem)
            if not text:
                continue

            chunk_id += 1
            toks = tokenize(text)
            total_words = len(toks)
            canonical_id = f"{spec['abbr']}{book_n}.{chapter_n}.{section_n}"
            location = f"{spec['sort_prefix']}.{spec['abbr'].rstrip('.')}.{book_n:03d}.{chapter_n:04d}.{section_n:03d}"
            heading = f"Thucydides {book_n}.{chapter_n}.{section_n}"

            chunks.append({
                "scene_id": chunk_id,
                "canonical_id": canonical_id,
                "location": location,
                "play_id": spec["play_id"],
                "play_title": spec["title"],
                "play_abbr": spec["abbr"],
                "genre": "History",
                "act": book_n,
                "act_label": book_label,
                "chapter": chapter_n,
                "chapter_label": f"Chapter {chapter_n}",
                "section": section_n,
                "scene": chapter_n * 1000 + section_n,
                "heading": heading,
                "total_words": total_words,
                "unique_words": len(set(toks)),
                "num_speeches": 0,
                "num_lines": 1,
                "characters_present_count": 1,
            })
            all_lines.append({
                "play_id": spec["play_id"],
                "canonical_id": canonical_id,
                "location": location,
                "act": book_n,
                "act_label": book_label,
                "chapter": chapter_n,
                "chapter_label": f"Chapter {chapter_n}",
                "section": section_n,
                "scene": chapter_n * 1000 + section_n,
                "line_num": chunk_id,
                "text": text,
            })

            counts1 = Counter(toks)
            counts2 = Counter(ngrams(toks, 2))
            counts3 = Counter(ngrams(toks, 3))
            for term, count in counts1.items():
                tokens1[term].append([chunk_id, count])
            for term, count in counts2.items():
                tokens2[term].append([chunk_id, count])
            for term, count in counts3.items():
                tokens3[term].append([chunk_id, count])

            act_totals[book_n] += total_words
            act_section_totals[book_n] += 1
            work_total_words += total_words
            work_total_sections += 1

    plays.append({
        "play_id": spec["play_id"],
        "location": f"{spec['sort_prefix']}.{spec['abbr'].rstrip('.')}",
        "title": spec["title"],
        "display_title": spec["display_title"],
        "abbr": spec["abbr"],
        "genre": "History",
        "first_performance_year": None,
        "num_acts": len(book_divs),
        "num_scenes": work_total_sections,
        "num_speeches": 0,
        "total_words": work_total_words,
        "total_lines": work_total_sections,
    })

    for character in characters:
        book_n = character["book_number"]
        character["total_words_spoken"] = act_totals[book_n]
        character["num_lines"] = act_section_totals[book_n]
        del character["book_number"]

    tokens1 = dedup_postings(tokens1)
    tokens2 = dedup_postings(tokens2)
    tokens3 = dedup_postings(tokens3)
    tokens_char, tokens_char2, tokens_char3 = build_character_indexes(characters)

    write_json(DATA_DIR / "plays.json", plays)
    write_json(DATA_DIR / "characters.json", characters)
    write_json(DATA_DIR / "chunks.json", chunks)
    write_json(DATA_DIR / "tokens.json", tokens1)
    write_json(DATA_DIR / "tokens2.json", tokens2)
    write_json(DATA_DIR / "tokens3.json", tokens3)
    write_json(DATA_DIR / "tokens_char.json", tokens_char)
    write_json(DATA_DIR / "tokens_char2.json", tokens_char2)
    write_json(DATA_DIR / "tokens_char3.json", tokens_char3)
    write_json(DATA_DIR / "character_name_filter_config.json", {
        "enabled": False,
        "notes": ["Disabled: this corpus does not yet have a reviewed proper-name list."],
        "global_additions": [], "global_removals": [],
        "play_additions": {}, "play_removals": {},
    })
    write_json(LINES_DIR / "all_lines.json", all_lines)

    print(
        f"Built {len(plays)} work, {len(characters)} books, {len(chunks)} sections, "
        f"{len(tokens1)} unigrams, {len(tokens2)} bigrams, {len(tokens3)} trigrams."
    )


if __name__ == "__main__":
    build()
