from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from glyph_inspect.commands import _sheet_font, _sheet_layout
from glyph_inspect.decl import parse_file

from conftest import make_block_png, make_pixel_png, write_decl

RED = (255, 0, 0, 255)
BLUE = (0, 0, 255, 255)


def sheet_groups() -> dict:
    return {
        "G": {
            "size": [2, 2],
            "count": 2,
            "texture": {"set": "main", "source": "b", "start": [0, 0], "direction": "right"},
            "unicode": [
                {"from": [0, 2], "to": "U+0041"},
                {"from": [0, 1], "to": "U+0043"},
            ],
        },
        "H": {
            "size": [4, 3],
            "count": 1,
            "imports": [
                {
                    "group": "G",
                    "offset": [0, 0],
                    "at": [{"from": [0, 1], "to": 0}],
                }
            ],
            "unicode": [{"from": [0, 1], "to": "U+0044"}],
        },
    }


def test_sheet_layout_labels_and_cell_border(tmp_path: Path, run):
    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    path = write_decl(tmp_path / "decl.json", sheet_groups())
    output = tmp_path / "sheet.png"
    result = run(
        "sheet",
        str(path),
        "--output",
        str(output),
        "--columns",
        "2",
        "--scale",
        "1",
        "--border",
        "--box-kind",
        "cell",
    )
    assert result.returncode == 0, result.stderr
    image = Image.open(output).convert("RGBA")

    declaration = parse_file(str(path))
    layout = _sheet_layout(declaration, True, _sheet_font())
    assert image.size == (2 * layout.slot_width, 2 * layout.slot_height)

    # All four slots have a label below the glyph area and a cell border that
    # starts one pixel outside the slot's local glyph origin.
    for position in range(4):
        row, column = divmod(position, 2)
        slot_x = column * layout.slot_width
        slot_y = row * layout.slot_height
        label_region = image.crop(
            (
                slot_x,
                slot_y + layout.label_y,
                slot_x + layout.slot_width,
                slot_y + layout.slot_height,
            )
        )
        assert _has_black(label_region)
        assert image.getpixel((slot_x, slot_y))[:3] == (0, 0, 0)

    # Glyph pixels are left/top aligned inside the border margin.
    assert image.getpixel((layout.margin, layout.margin)) == RED
    assert image.getpixel((layout.slot_width + layout.margin, layout.margin)) == BLUE


def _has_black(image: Image.Image) -> bool:
    return any(
        pixel[0] < 40 and pixel[1] < 40 and pixel[2] < 40 and pixel[3] > 0
        for pixel in image.getdata()
    )


def test_ink_border_differs_from_cell_and_skips_empty(tmp_path: Path, run):
    rows = [[(0, 0, 0, 0) for _ in range(4)] for _ in range(4)]
    rows[1][2] = RED
    make_pixel_png(tmp_path / "one.png", rows)
    groups = {
        "G": {
            "size": [4, 4],
            "count": 2,
            "texture": {"set": "main", "source": "one", "start": [0, 0], "direction": "down"},
            "unicode": [{"from": [0, 2], "to": "U+0041"}],
        }
    }
    # Index 1 is fully outside the 4x4 texture for direction down; make a
    # separate empty texture instead.
    groups["G"]["texture"] = {
        "set": "main", "source": "one",
        "start": [0, 0],
        "direction": "right",
    }
    groups["G"]["count"] = 2
    groups["G"]["unicode"] = [{"from": [0, 1], "to": "U+0041"}]
    groups["E"] = {"size": [4, 4], "count": 1, "unicode": [{"from": [0, 1], "to": "U+0042"}]}
    path = write_decl(tmp_path / "decl.json", groups)

    declaration = parse_file(str(path))
    layout = _sheet_layout(declaration, True, _sheet_font())
    cell = run(
        "sheet", str(path), "--output", str(tmp_path / "cell.png"),
        "--columns", "1", "--scale", "1", "--border", "--box-kind", "cell",
    )
    assert cell.returncode == 0, cell.stderr
    ink = run(
        "sheet", str(path), "--output", str(tmp_path / "ink.png"),
        "--columns", "1", "--scale", "1", "--border", "--box-kind", "ink",
    )
    assert ink.returncode == 0, ink.stderr

    cell_image = Image.open(tmp_path / "cell.png").convert("RGBA")
    ink_image = Image.open(tmp_path / "ink.png").convert("RGBA")
    # The cell border surrounds the whole 4x4 group box at the slot origin.
    assert cell_image.getpixel((0, 0))[:3] == (0, 0, 0)
    # The ink border is one pixel outside the single lit pixel at (2,1).
    assert ink_image.getpixel((0, 0))[:3] == (255, 255, 255)
    assert ink_image.getpixel((2, 1))[:3] == (0, 0, 0)
    assert ink_image.getpixel((0, layout.slot_height))[:3] == (255, 255, 255)


def test_page_split_manifest_and_no_missing_glyphs(tmp_path: Path, run):
    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    groups = {
        "G": {
            "size": [2, 2],
            "count": 2,
            "texture": {"set": "main", "source": "b", "start": [0, 0], "direction": "right"},
            "unicode": [
                {"from": [0, 2], "to": "U+0041"},
                {"from": [0, 1], "to": "U+0043"},
                {"from": [1, 2], "to": "U+0044"},
                {"from": [0, 1], "to": "U+0045"},
            ],
        }
    }
    path = write_decl(tmp_path / "decl.json", groups)
    output = tmp_path / "pages"
    result = run(
        "sheet", str(path), "--output", str(output), "--per-page", "2",
        "--columns", "2", "--scale", "1",
    )
    assert result.returncode == 0, result.stderr
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["total"] == 5
    assert [page["file"] for page in manifest["pages"]] == [
        "page-0001.png",
        "page-0002.png",
        "page-0003.png",
    ]
    assert [page["count"] for page in manifest["pages"]] == [2, 2, 1]
    assert manifest["pages"][0]["first"] == "U+0041"
    assert manifest["pages"][-1]["last"] == "U+0045"
    assert sorted(p.name for p in output.glob("page-*.png")) == [
        "page-0001.png",
        "page-0002.png",
        "page-0003.png",
    ]

    red = blue = 0
    for page in manifest["pages"]:
        image = Image.open(output / page["file"]).convert("RGBA")
        pixels = list(image.getdata())
        red += pixels.count(RED)
        blue += pixels.count(BLUE)
    assert red == 3 * 4
    assert blue == 2 * 4

    # Re-running with fewer pages removes stale pages from the old bundle.
    result = run(
        "sheet", str(path), "--output", str(output), "--per-page", "5",
        "--columns", "2", "--scale", "1",
    )
    assert result.returncode == 0, result.stderr
    assert sorted(p.name for p in output.glob("page-*.png")) == ["page-0001.png"]


def test_sheet_size_limit_requires_page_split(tmp_path: Path, run):
    groups = {
        "G": {
            "size": [40000, 1],
            "count": 1,
            "unicode": [{"from": [0, 1], "to": "U+0041"}],
        }
    }
    path = write_decl(tmp_path / "decl.json", groups)
    output = tmp_path / "huge.png"
    result = run("sheet", str(path), "--output", str(output), "--scale", "1")
    assert result.returncode == 4
    assert b"per-page" in result.stderr
    assert not output.exists()

    pages = tmp_path / "pages"
    result = run(
        "sheet", str(path), "--output", str(pages), "--per-page", "1", "--scale", "1"
    )
    assert result.returncode == 4
    assert not (pages / "manifest.json").exists()


def test_page_output_parent_must_exist_but_directory_is_created(tmp_path: Path, run):
    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    path = write_decl(tmp_path / "decl.json", sheet_groups())
    missing = tmp_path / "missing" / "pages"
    result = run("sheet", str(path), "--output", str(missing), "--per-page", "2")
    assert result.returncode == 4
    assert not missing.exists()

    created = tmp_path / "pages"
    result = run("sheet", str(path), "--output", str(created), "--per-page", "2")
    assert result.returncode == 0, result.stderr
    assert (created / "manifest.json").is_file()


def test_sheet_without_mappings_is_an_error(tmp_path: Path, run):
    path = write_decl(
        tmp_path / "decl.json",
        {"G": {"size": [1, 1], "count": 1}},
    )
    result = run("sheet", str(path), "--output", str(tmp_path / "s.png"))
    assert result.returncode == 3
