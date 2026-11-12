from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw


def write_decl(
    path: Path, groups: dict, texture_sets: dict[str, dict[str, str]] | None = None
) -> Path:
    # Small test fixtures use source names matching local <name>.png files.
    # Pass texture_sets explicitly when testing other paths or bad references.
    if texture_sets is None:
        sources = {
            group["texture"]["source"]
            for group in groups.values()
            if "texture" in group
        }
        texture_sets = {"main": {name: f"{name}.png" for name in sources}} if sources else {}
    document: dict = {"groups": groups}
    if texture_sets:
        document["texture_sets"] = texture_sets
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return path


def make_block_png(path: Path, blocks: list[list[tuple[int, int, int, int]]], block=2) -> Path:
    """blocks[row][column] is one block-coloured cell."""
    width = len(blocks[0]) * block
    height = len(blocks) * block
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for row, colors in enumerate(blocks):
        for column, color in enumerate(colors):
            draw.rectangle(
                (
                    column * block,
                    row * block,
                    column * block + block - 1,
                    row * block + block - 1,
                ),
                fill=color,
            )
    image.save(path, format="PNG")
    return path


def make_pixel_png(path: Path, rows: list[list[tuple[int, int, int, int]]]) -> Path:
    image = Image.new("RGBA", (len(rows[0]), len(rows)), (0, 0, 0, 0))
    pixels = image.load()
    for y, row in enumerate(rows):
        for x, color in enumerate(row):
            pixels[x, y] = color
    image.save(path, format="PNG")
    return path


def run_cli(*args: str, input_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "glyph_inspect.cli", *args],
        input=input_bytes,
        capture_output=True,
    )


@pytest.fixture
def run():
    return run_cli
