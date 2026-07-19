"""Tests for the document chunker (runtime/chunking.py)."""

import pytest

from ontoforge_server.runtime.chunking import chunk_document


# ---------------------------------------------------------------------------
# Trivial cases
# ---------------------------------------------------------------------------


def test_empty_text_returns_no_chunks():
    assert chunk_document("", 1500, 200) == []


def test_short_text_returns_single_chunk():
    text = "A short document."
    chunks = chunk_document(text, 1500, 200)
    assert len(chunks) == 1
    assert chunks[0].start_char == 0
    assert chunks[0].char_length == len(text)
    assert chunks[0].text == text


def test_text_exactly_at_size_returns_single_chunk():
    text = "x" * 100
    chunks = chunk_document(text, 100, 20)
    assert len(chunks) == 1
    assert chunks[0].text == text


def test_invalid_size_raises():
    with pytest.raises(ValueError):
        chunk_document("text", 0, 0)


def test_invalid_overlap_raises():
    with pytest.raises(ValueError):
        chunk_document("text", 100, 100)
    with pytest.raises(ValueError):
        chunk_document("text", 100, -1)


# ---------------------------------------------------------------------------
# Coordinates
# ---------------------------------------------------------------------------


def test_offsets_are_exact_coordinates_in_source():
    """Every chunk's startChar/charLength must slice back to its text."""
    text = "Lorem ipsum dolor sit amet. " * 100  # 2800 chars
    chunks = chunk_document(text, 500, 100)
    assert len(chunks) > 1
    for chunk in chunks:
        assert text[chunk.start_char:chunk.start_char + chunk.char_length] == chunk.text
        assert chunk.char_length == len(chunk.text)


def test_chunks_cover_entire_document():
    """First chunk starts at 0, last chunk ends at len(text), no gaps."""
    text = "word " * 500  # 2500 chars
    chunks = chunk_document(text, 400, 50)
    assert chunks[0].start_char == 0
    last = chunks[-1]
    assert last.start_char + last.char_length == len(text)
    # No gaps: each chunk starts at or before the previous chunk's end
    for prev, curr in zip(chunks, chunks[1:]):
        assert curr.start_char <= prev.start_char + prev.char_length
        assert curr.start_char > prev.start_char  # always advances


# ---------------------------------------------------------------------------
# Overlap
# ---------------------------------------------------------------------------


def test_consecutive_chunks_overlap():
    text = "x" * 1000  # no boundaries: hard splits
    chunks = chunk_document(text, 300, 50)
    for prev, curr in zip(chunks, chunks[1:]):
        prev_end = prev.start_char + prev.char_length
        overlap = prev_end - curr.start_char
        assert overlap == 50


def test_no_overlap_when_zero():
    text = "x" * 1000
    chunks = chunk_document(text, 300, 0)
    for prev, curr in zip(chunks, chunks[1:]):
        assert curr.start_char == prev.start_char + prev.char_length


# ---------------------------------------------------------------------------
# Boundary preference
# ---------------------------------------------------------------------------


def test_prefers_paragraph_boundary():
    para1 = "First paragraph. " * 10  # 170 chars
    para2 = "Second paragraph content here."
    text = para1.rstrip() + "\n\n" + para2
    chunks = chunk_document(text, 180, 20)
    # First chunk should end right after the paragraph break
    assert chunks[0].text.endswith("\n\n")


def test_prefers_sentence_boundary_over_whitespace():
    # No paragraph breaks; sentences end mid-way
    text = ("This is sentence one. This is sentence two. " * 10).rstrip()
    chunks = chunk_document(text, 100, 10)
    assert len(chunks) > 1
    # Each non-final chunk should end after a sentence separator
    for chunk in chunks[:-1]:
        assert chunk.text.endswith(". ")


def test_falls_back_to_whitespace_boundary():
    text = "supercalifragilistic " * 50  # words longer than sentence patterns
    chunks = chunk_document(text, 100, 10)
    for chunk in chunks[:-1]:
        assert chunk.text.endswith(" ")


def test_hard_split_when_no_boundaries():
    text = "a" * 1000
    chunks = chunk_document(text, 300, 0)
    assert [c.char_length for c in chunks[:-1]] == [300, 300, 300]
    assert chunks[-1].char_length == 100
