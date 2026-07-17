"""Character-based document chunking with overlap.

Splits large document property values into fixed-size chunks, preferring
paragraph, then sentence, then whitespace boundaries near the target size.
Each chunk records its exact character coordinates in the original document
so passages can be retrieved via the document read endpoint.
"""

from __future__ import annotations

import dataclasses


@dataclasses.dataclass
class Chunk:
    """A chunk of a document with exact character coordinates."""

    start_char: int
    char_length: int
    text: str


# Boundary patterns in order of preference. Each is searched backwards from
# the target split point; the split happens AFTER the matched separator.
_SENTENCE_ENDINGS = (". ", "! ", "? ", ".\n", "!\n", "?\n")


def _find_split_point(text: str, start: int, target_end: int) -> int:
    """Find the best split point for a chunk starting at *start*.

    Prefers a paragraph break, then a sentence ending, then any whitespace —
    searching backwards from *target_end* but never below the midpoint of the
    chunk (to avoid degenerate tiny chunks). Falls back to a hard split at
    *target_end*.
    """
    min_end = start + (target_end - start) // 2

    # 1. Paragraph boundary ("\n\n") — split after the blank line
    idx = text.rfind("\n\n", min_end, target_end)
    if idx != -1:
        return idx + 2

    # 2. Sentence boundary — split after the punctuation + separator
    best = -1
    for sep in _SENTENCE_ENDINGS:
        idx = text.rfind(sep, min_end, target_end)
        if idx != -1:
            best = max(best, idx + len(sep))
    if best != -1:
        return best

    # 3. Any whitespace — split after the whitespace character
    for i in range(target_end - 1, min_end - 1, -1):
        if text[i].isspace():
            return i + 1

    # 4. Hard split
    return target_end


def chunk_document(text: str, size: int, overlap: int) -> list[Chunk]:
    """Split *text* into chunks of roughly *size* characters with *overlap*.

    Returns an empty list for empty text. A text shorter than *size* yields a
    single chunk. Consecutive chunks overlap by roughly *overlap* characters
    (exact overlap depends on the boundary chosen for the previous chunk).
    """
    if not text:
        return []
    if size <= 0:
        raise ValueError("Chunk size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("Chunk overlap must be >= 0 and smaller than size")

    chunks: list[Chunk] = []
    pos = 0
    length = len(text)

    while pos < length:
        target_end = pos + size
        if target_end >= length:
            end = length
        else:
            end = _find_split_point(text, pos, target_end)

        chunks.append(Chunk(start_char=pos, char_length=end - pos, text=text[pos:end]))

        if end >= length:
            break
        # Step back by the overlap, but always advance past the previous start.
        pos = max(end - overlap, pos + 1)

    return chunks
