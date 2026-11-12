"""Convert 8x4x4 Hangul parts or 8x16 DOS font glyphs to PNG atlases.

Usage (from the project root): python3 tools/font_bin_to_png.py input.bin [output.png]
Examples:
    python3 tools/font_bin_to_png.py                    # show help
    python3 tools/font_bin_to_png.py examples/hangul.bin # examples/hangul.png
    python3 tools/font_bin_to_png.py examples/ascii.bin  # examples/ascii.png
Requires Pillow. Output defaults to a PNG beside the input file.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image

CELL = 16
SLOT_BYTES = 32  # 16 rows, two bytes per row (most significant bit = leftmost pixel)
# Each variant begins with one empty reserved slot, followed by its real glyphs.
SECTIONS = ((8, 20), (4, 22), (4, 28))  # initial, medial, final
ATLAS_COLUMNS = 27
ATLAS_ROWS = sum(variants for variants, _ in SECTIONS)
EXPECTED_BYTES = sum(variants * slots * SLOT_BYTES for variants, slots in SECTIONS)
DOS_COLUMNS = DOS_ROWS = 16
DOS_WIDTH = 8
DOS_HEIGHT = 16
DOS_EXPECTED_BYTES = DOS_COLUMNS * DOS_ROWS * DOS_HEIGHT


def convert_hangul(data: bytes) -> Image.Image:
    atlas = Image.new("RGBA", (ATLAS_COLUMNS * CELL, ATLAS_ROWS * CELL))
    pixels = atlas.load()
    offset = 0
    atlas_row = 0
    for variants, slots in SECTIONS:
        for _ in range(variants):
            if any(data[offset : offset + SLOT_BYTES]):
                raise ValueError(f"reserved first slot of variant row {atlas_row} is not empty")
            offset += SLOT_BYTES
            for column in range(slots - 1):
                glyph = data[offset : offset + SLOT_BYTES]
                offset += SLOT_BYTES
                for y in range(CELL):
                    row = (glyph[2 * y] << 8) | glyph[2 * y + 1]
                    for x in range(CELL):
                        if row & (0x8000 >> x):
                            pixels[column * CELL + x, atlas_row * CELL + y] = (0, 0, 0, 255)
            atlas_row += 1
    return atlas


def convert_dos(data: bytes) -> Image.Image:
    """Keep all 256 original glyph slots, without interpreting their code page."""
    atlas = Image.new("RGBA", (DOS_COLUMNS * DOS_WIDTH, DOS_ROWS * DOS_HEIGHT))
    pixels = atlas.load()
    for index in range(DOS_COLUMNS * DOS_ROWS):
        left = (index % DOS_COLUMNS) * DOS_WIDTH
        top = (index // DOS_COLUMNS) * DOS_HEIGHT
        for y in range(DOS_HEIGHT):
            row = data[index * DOS_HEIGHT + y]
            for x in range(DOS_WIDTH):
                if row & (0x80 >> x):
                    pixels[left + x, top + y] = (0, 0, 0, 255)
    return atlas


def convert(source: Path, destination: Path | None = None) -> None:
    data = source.read_bytes()
    if len(data) == EXPECTED_BYTES:
        atlas = convert_hangul(data)
        default_name = "hangul.png"
    elif len(data) == DOS_EXPECTED_BYTES:
        atlas = convert_dos(data)
        default_name = "ascii.png"
    else:
        raise ValueError(
            f"expected {EXPECTED_BYTES} bytes (Hangul) or {DOS_EXPECTED_BYTES} bytes "
            f"(8x16 DOS), got {len(data)}: {source}"
        )

    if destination is None:
        destination = source.with_name(default_name)
    atlas.save(destination, format="PNG")
    print(f"{source} -> {destination} ({atlas.width}x{atlas.height})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", nargs="?", type=Path)
    if len(sys.argv) == 1:
        parser.print_help()
        return
    args = parser.parse_args()
    try:
        convert(args.input, args.output)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"error: {exc}\n")


if __name__ == "__main__":
    main()
