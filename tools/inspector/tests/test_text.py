from __future__ import annotations

from pathlib import Path

from PIL import Image

from conftest import make_block_png, write_decl

RED = (255, 0, 0, 255)
BLUE = (0, 0, 255, 255)


def text_groups(with_zero: bool = True) -> dict:
    groups = {
        "G": {
            "size": [2, 2],
            "count": 2,
            "texture": {"set": "main", "source": "b", "start": [0, 0], "direction": "right"},
            "unicode": [{"from": [0, 2], "to": "U+0041"}],
        },
        "H": {
            "size": [4, 3],
            "count": 1,
            "unicode": [{"from": [0, 1], "to": "U+0043"}],
        },
    }
    if with_zero:
        groups["N"] = {
            "size": [3, 1],
            "count": 1,
            "unicode": [{"from": [0, 1], "to": "U+0000"}],
        }
    return groups


def render_text(tmp_path: Path, run, groups: dict, *args: str) -> Image.Image | None:
    tmp_path.mkdir(parents=True, exist_ok=True)
    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    path = write_decl(tmp_path / "decl.json", groups)
    output = tmp_path / "text.png"
    result = run("text", str(path), *args, "--output", str(output), "--scale", "1")
    assert result.returncode == 0, result.stderr
    return Image.open(output).convert("RGBA")


def test_mapped_characters_and_line_height(tmp_path: Path, run):
    image = render_text(tmp_path, run, text_groups(), "--text", "AB")
    assert image.size == (4, 3)
    assert image.getpixel((0, 0)) == RED
    assert image.getpixel((2, 0)) == BLUE
    assert image.getpixel((0, 2)) == (255, 255, 255, 255)


def test_missing_character_without_zero_draws_outline_box(tmp_path: Path, run):
    image = render_text(tmp_path, run, text_groups(False), "--text", "A?")
    assert image.size == (6, 3)
    assert image.getpixel((0, 0)) == RED
    # The fallback box is the maximum mapped result-group size 4x3.
    assert image.getpixel((2, 0))[:3] == (0, 0, 0)
    assert image.getpixel((5, 2))[:3] == (0, 0, 0)
    assert image.getpixel((4, 1)) == (255, 255, 255, 255)


def test_zero_mapping_is_used_for_missing_characters_even_when_empty(tmp_path: Path, run):
    image = render_text(tmp_path, run, text_groups(), "--text", "A?")
    assert image.size == (5, 3)
    assert image.getpixel((0, 0)) == RED
    # N is 3 wide and empty: advance changes, no outline box is drawn.
    assert all(
        image.getpixel((x, y)) == (255, 255, 255, 255)
        for x in range(2, 5)
        for y in range(3)
    )


def test_multiline_empty_lines_and_trailing_newline(tmp_path: Path, run):
    image = render_text(tmp_path, run, text_groups(), "--text", "A\n\nB")
    assert image.size == (2, 9)
    assert image.getpixel((0, 0)) == RED
    assert image.getpixel((0, 6)) == BLUE
    assert all(
        image.getpixel((x, y)) == (255, 255, 255, 255)
        for x in range(2)
        for y in range(3, 6)
    )

    image = render_text(tmp_path, run, text_groups(), "--text", "A\n")
    assert image.size == (2, 6)


def test_crlf_and_cr_are_normalized(tmp_path: Path, run):
    lf = render_text(tmp_path / "lf", run, text_groups(), "--text", "A\nB")
    crlf = render_text(tmp_path / "crlf", run, text_groups(), "--text", "A\r\nB")
    cr = render_text(tmp_path / "cr", run, text_groups(), "--text", "A\rB")
    assert list(lf.getdata()) == list(crlf.getdata()) == list(cr.getdata())


def test_text_file_with_real_nul(tmp_path: Path, run):
    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    path = write_decl(tmp_path / "decl.json", text_groups())
    text_file = tmp_path / "input.txt"
    text_file.write_bytes(b"A\x00B")
    output = tmp_path / "text.png"
    result = run(
        "text", str(path), "--text-file", str(text_file),
        "--output", str(output), "--scale", "1",
    )
    assert result.returncode == 0, result.stderr
    image = Image.open(output).convert("RGBA")
    assert image.size == (7, 3)
    assert image.getpixel((0, 0)) == RED
    assert image.getpixel((5, 0)) == BLUE

    stdin_result = run(
        "text", str(path), "--text-file", "-",
        "--output", str(tmp_path / "stdin.png"), "--scale", "1",
        input_bytes=b"\x00",
    )
    assert stdin_result.returncode == 0, stdin_result.stderr
    assert Image.open(tmp_path / "stdin.png").size == (3, 3)


def test_background_scale_and_empty_errors(tmp_path: Path, run):
    transparent = render_text(
        tmp_path / "t", run, text_groups(), "--text", "A",
        "--background", "transparent",
    )
    white = render_text(tmp_path / "w", run, text_groups(), "--text", "A")
    assert transparent.getpixel((1, 2))[3] == 0
    assert white.getpixel((1, 2)) == (255, 255, 255, 255)

    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    path = write_decl(tmp_path / "decl.json", text_groups())
    output = tmp_path / "scaled.png"
    result = run(
        "text", str(path), "--text", "A", "--output", str(output), "--scale", "2"
    )
    assert result.returncode == 0, result.stderr
    scaled = Image.open(output).convert("RGBA")
    assert scaled.size == (4, 6)
    assert scaled.getpixel((0, 0)) == RED
    assert scaled.getpixel((1, 1)) == RED

    empty = run(
        "text", str(path), "--text", "", "--output", str(tmp_path / "e.png")
    )
    assert empty.returncode == 2

    no_mapping = write_decl(
        tmp_path / "empty.json", {"G": {"size": [1, 1], "count": 1}}
    )
    result = run(
        "text", str(no_mapping), "--text", "A", "--output", str(tmp_path / "n.png")
    )
    assert result.returncode == 3

    bad_utf8 = tmp_path / "bad.txt"
    bad_utf8.write_bytes(b"\xff\xfe")
    result = run(
        "text", str(path), "--text-file", str(bad_utf8),
        "--output", str(tmp_path / "bad.png"),
    )
    assert result.returncode == 2

    empty_file = tmp_path / "empty.txt"
    empty_file.write_bytes(b"")
    result = run(
        "text", str(path), "--text-file", str(empty_file),
        "--output", str(tmp_path / "empty.png"),
    )
    assert result.returncode == 2
