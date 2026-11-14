#!/usr/bin/env python3
"""Generate ASCII or Hangul declaration JSON from the canonical examples.

The examples supply every group, import, repetition axis and Unicode mapping.
This tool only resizes group cells and texture row starts.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"
TEMPLATES = {
    "ascii": EXAMPLES / "ascii.json",
    "hangul": EXAMPLES / "hangul.json",
}
BASE_CELL_HEIGHT = 16


def generate_declaration(mode: str, width: int, height: int) -> dict:
    """Return a declaration for ``width`` x ``height`` ASCII cells.

    Hangul components and syllables use twice the ASCII width.
    """
    if mode not in TEMPLATES:
        raise ValueError(f"unknown mode: {mode!r}")
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive integers")

    with TEMPLATES[mode].open(encoding="utf-8") as source:
        declaration = json.load(source)

    declaration = copy.deepcopy(declaration)
    metadata = declaration.get("metadata", {})
    if "description" in metadata:
        metadata["description"] = metadata["description"].replace(
            "8x16", f"{width}x{height}"
        )

    for group in declaration["groups"].values():
        texture = group.get("texture")
        is_ascii = texture is not None and texture.get("source") == "ascii"
        group["size"] = [width if is_ascii else 2 * width, height]
        if texture is not None:
            x0, y0 = texture["start"]
            texture["start"] = [x0, (y0 // BASE_CELL_HEIGHT) * height]

    return declaration


def positive_int(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"양의 정수가 아닙니다: {text!r}") from None
    if value <= 0:
        raise argparse.ArgumentTypeError(f"1 이상의 정수가 필요합니다: {text!r}")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="ASCII 또는 한글+ASCII 선언 JSON을 생성합니다.",
        epilog=(
            "예: python3 tools/generate_declaration.py "
            "--hangul 8 16 -o hangul.json"
        ),
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--ascii", action="store_true", help="ASCII 선언 생성")
    mode.add_argument(
        "--hangul",
        action="store_true",
        help="한글+ASCII 선언 생성 (한글 부품·음절은 2w x h)",
    )
    parser.add_argument("width", type=positive_int, metavar="w", help="ASCII 셀 너비")
    parser.add_argument("height", type=positive_int, metavar="h", help="셀 높이")
    parser.add_argument(
        "-o",
        "--output",
        metavar="OUTPUT",
        help="출력 파일 경로 (기본: 표준 출력, '-'도 표준 출력)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    mode = "ascii" if args.ascii else "hangul"
    declaration = generate_declaration(mode, args.width, args.height)
    text = json.dumps(declaration, ensure_ascii=False, indent=2) + "\n"

    if args.output in (None, "-"):
        sys.stdout.buffer.write(text.encode("utf-8"))
    else:
        Path(args.output).write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
