"""Implementations of the list, groups, sheet and text subcommands."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .decl import Declaration
from .errors import DeclError, ResourceError, UsageError
from .render import Renderer, _composite_at

MAX_SHEET_PIXELS = 100_000_000
MAX_SHEET_SIDE = 32_768


# ---------------------------------------------------------------------------
# shared output helpers


def _codepoint_label(codepoint: int) -> str:
    return f"U+{codepoint:04X}"


def _display_character(codepoint: int) -> str:
    character = chr(codepoint)
    category = unicodedata.category(character)
    if category[0] == "C" or category in ("Zl", "Zp"):
        if codepoint <= 0xFFFF:
            return f"\\u{codepoint:04x}"
        return f"\\U{codepoint:08x}"
    return character


def _json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=None, separators=(",", ":"))


def write_payload(text: str, output: str | None) -> None:
    data = text.encode("utf-8")
    if output is None:
        buffer = getattr(sys.stdout, "buffer", None)
        if buffer is not None:
            buffer.write(data)
            buffer.flush()
        else:
            sys.stdout.write(text)
        return
    _atomic_write(Path(output), data)


def _atomic_write(path: Path, data: bytes) -> None:
    parent = path.parent
    if not parent.is_dir():
        raise ResourceError(f"출력 디렉터리가 없습니다: {parent}")
    if path.is_dir():
        raise ResourceError(f"출력 경로가 디렉터리입니다: {path}")
    temporary: str | None = None
    try:
        fd, temporary = tempfile.mkstemp(
            dir=parent, prefix=".glyph-inspect-", suffix=".tmp"
        )
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(temporary, path)
        temporary = None
    except OSError as exc:
        raise ResourceError(f"출력 파일을 쓸 수 없습니다: {path} ({exc.strerror})") from None
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def _atomic_png(image: Image.Image, path: Path) -> None:
    parent = path.parent
    if not parent.is_dir():
        raise ResourceError(f"출력 디렉터리가 없습니다: {parent}")
    if path.is_dir():
        raise ResourceError(f"출력 경로가 디렉터리입니다: {path}")
    temporary: str | None = None
    try:
        fd, temporary = tempfile.mkstemp(
            dir=parent, prefix=".glyph-inspect-", suffix=".png"
        )
        os.close(fd)
        image.save(temporary, format="PNG")
        os.replace(temporary, path)
        temporary = None
    except OSError as exc:
        raise ResourceError(f"출력 파일을 쓸 수 없습니다: {path} ({exc.strerror})") from None
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# list / groups


def list_entries(declaration: Declaration) -> list[dict[str, str]]:
    return [
        {"codepoint": _codepoint_label(codepoint), "character": chr(codepoint)}
        for codepoint in sorted(declaration.unicode_map)
    ]


def group_entries(
    declaration: Declaration, with_parts: bool
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for codepoint in sorted(declaration.unicode_map):
        group_name, index = declaration.unicode_map[codepoint]
        entry: dict[str, object] = {
            "codepoint": _codepoint_label(codepoint),
            "character": chr(codepoint),
            "groups": declaration.participating_groups(group_name, index),
        }
        if with_parts:
            entry["parts"] = declaration.parts(group_name, index)
        entries.append(entry)
    return entries


def render_list_text(entries: list[dict[str, str]]) -> str:
    lines = []
    for entry in entries:
        codepoint = int(entry["codepoint"][2:], 16)
        lines.append(f"{entry['codepoint']}\t{_display_character(codepoint)}")
    return "".join(line + "\n" for line in lines)


def render_groups_text(entries: list[dict[str, object]]) -> str:
    lines = []
    for entry in entries:
        codepoint = int(str(entry["codepoint"])[2:], 16)
        groups = ",".join(str(name) for name in entry["groups"])  # type: ignore[union-attr]
        lines.append(f"{entry['codepoint']}\t{_display_character(codepoint)}\t{groups}")
    return "".join(line + "\n" for line in lines)


# ---------------------------------------------------------------------------
# sheet


@dataclass(frozen=True)
class SheetLayout:
    slot_width: int
    slot_height: int
    max_width: int
    max_height: int
    margin: int
    label_x: int
    label_y: int
    font: ImageFont.ImageFont


def _sheet_font() -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default(size=11)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def _sheet_layout(
    declaration: Declaration, border: bool, font: ImageFont.ImageFont
) -> SheetLayout:
    max_width = max(
        declaration.groups[name].size[0] for name, _ in declaration.unicode_map.values()
    )
    max_height = max(
        declaration.groups[name].size[1] for name, _ in declaration.unicode_map.values()
    )
    label_pad = 1  # room for the label's 1px outline
    label_height = max(1, font.getbbox("U+0000")[3])
    label_width = max(
        int(round(font.getlength(_codepoint_label(codepoint))))
        for codepoint in declaration.unicode_map
    )
    margin = 1 if border else 0
    slot_width = max(max_width, label_width + 2 * label_pad) + 2 * margin
    slot_height = (
        margin + max_height + 2 + label_height + 2 * label_pad + margin
    )
    return SheetLayout(
        slot_width=slot_width,
        slot_height=slot_height,
        max_width=max_width,
        max_height=max_height,
        margin=margin,
        label_x=margin + label_pad,
        label_y=margin + max_height + 2 + label_pad,
        font=font,
    )


def _check_sheet_limits(width: int, height: int) -> None:
    if (
        width * height > MAX_SHEET_PIXELS
        or width > MAX_SHEET_SIDE
        or height > MAX_SHEET_SIDE
    ):
        raise ResourceError(
            "PNG 크기 한도를 넘습니다 "
            f"({width}x{height}; 최대 {MAX_SHEET_SIDE}px 한 변, "
            f"{MAX_SHEET_PIXELS} 화소). --per-page로 페이지를 나누세요"
        )


def _page_layout(
    codepoints: list[int],
    columns: int,
    layout: SheetLayout,
) -> tuple[int, int, int]:
    cols = min(columns, len(codepoints))
    rows = (len(codepoints) + cols - 1) // cols
    return cols, rows, cols * layout.slot_width


def _render_sheet_page(
    declaration: Declaration,
    renderer: Renderer,
    codepoints: list[int],
    columns: int,
    layout: SheetLayout,
    border: bool,
    box_kind: str,
    background: str,
    scale: int,
) -> Image.Image:
    cols, rows, _ = _page_layout(codepoints, columns, layout)
    width = cols * layout.slot_width
    height = rows * layout.slot_height
    _check_sheet_limits(width * scale, height * scale)

    page = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for position, codepoint in enumerate(codepoints):
        row, column = divmod(position, cols)
        x = column * layout.slot_width + layout.margin
        y = row * layout.slot_height + layout.margin
        group_name, index = declaration.unicode_map[codepoint]
        glyph = renderer.glyph(group_name, index)
        _composite_at(page, glyph, x, y)

    if background == "white":
        white = Image.new("RGBA", page.size, (255, 255, 255, 255))
        white.alpha_composite(page)
        page = white

    draw = ImageDraw.Draw(page)
    for position, codepoint in enumerate(codepoints):
        row, column = divmod(position, cols)
        slot_x = column * layout.slot_width
        slot_y = row * layout.slot_height
        x = slot_x + layout.margin
        y = slot_y + layout.margin
        group_name, index = declaration.unicode_map[codepoint]
        group = declaration.groups[group_name]
        if border:
            if box_kind == "cell":
                box = (x - 1, y - 1, x + group.size[0], y + group.size[1])
                draw.rectangle(box, outline=(0, 0, 0, 255))
            else:
                glyph = renderer.glyph(group_name, index)
                ink = glyph.getchannel("A").getbbox()
                if ink is not None:
                    left, top, right, bottom = ink
                    box = (x + left - 1, y + top - 1, x + right, y + bottom)
                    draw.rectangle(box, outline=(0, 0, 0, 255))
        draw.text(
            (slot_x + layout.label_x, slot_y + layout.label_y),
            _codepoint_label(codepoint),
            font=layout.font,
            fill=(0, 0, 0, 255),
            stroke_width=1,
            stroke_fill=(255, 255, 255, 255),
        )

    if scale != 1:
        page = page.resize(
            (page.width * scale, page.height * scale), Image.Resampling.NEAREST
        )
    return page


def run_sheet(
    declaration: Declaration,
    output: str,
    columns: int,
    scale: int,
    border: bool,
    box_kind: str,
    background: str,
    per_page: int | None,
) -> None:
    if not declaration.unicode_map:
        raise DeclError("유니코드 매핑이 하나도 없어 시트를 만들 수 없습니다")
    renderer = Renderer(declaration)
    renderer.check_textures()
    font = _sheet_font()
    layout = _sheet_layout(declaration, border, font)
    codepoints = sorted(declaration.unicode_map)

    if per_page is None:
        page = _render_sheet_page(
            declaration,
            renderer,
            codepoints,
            columns,
            layout,
            border,
            box_kind,
            background,
            scale,
        )
        _atomic_png(page, Path(output))
        return

    directory = Path(output)
    if directory.exists() and not directory.is_dir():
        raise ResourceError(f"페이지 출력 경로가 디렉터리가 아닙니다: {directory}")
    try:
        directory.mkdir(exist_ok=True)
    except OSError as exc:
        raise ResourceError(
            f"페이지 출력 디렉터리를 만들 수 없습니다: {directory} ({exc.strerror})"
        ) from None

    chunks = [
        codepoints[offset : offset + per_page]
        for offset in range(0, len(codepoints), per_page)
    ]
    # Validate every page's final dimensions before touching outputs.
    for chunk in chunks:
        cols, rows, _ = _page_layout(chunk, columns, layout)
        _check_sheet_limits(
            cols * layout.slot_width * scale, rows * layout.slot_height * scale
        )

    temporaries: list[tuple[Path, Path]] = []
    finals: list[Path] = []
    try:
        for number, chunk in enumerate(chunks, start=1):
            page = _render_sheet_page(
                declaration,
                renderer,
                chunk,
                columns,
                layout,
                border,
                box_kind,
                background,
                scale,
            )
            final = directory / f"page-{number:04d}.png"
            fd, temporary = tempfile.mkstemp(
                dir=directory, prefix=".glyph-inspect-", suffix=".png"
            )
            os.close(fd)
            page.save(temporary, format="PNG")
            temporaries.append((Path(temporary), final))
            finals.append(final)
        for temporary, final in temporaries:
            os.replace(temporary, final)
        temporaries.clear()
        _remove_stale_pages(directory, set(finals))
        manifest = {
            "total": len(codepoints),
            "pages": [
                {
                    "file": final.name,
                    "count": len(chunk),
                    "first": _codepoint_label(chunk[0]),
                    "last": _codepoint_label(chunk[-1]),
                }
                for final, chunk in zip(finals, chunks)
            ],
        }
        _atomic_write(
            directory / "manifest.json",
            (_json_text(manifest) + "\n").encode("utf-8"),
        )
    except OSError as exc:
        raise ResourceError(
            f"페이지 출력을 쓸 수 없습니다: {directory} ({exc.strerror})"
        ) from None
    finally:
        for temporary, _ in temporaries:
            try:
                temporary.unlink()
            except OSError:
                pass


def _remove_stale_pages(directory: Path, keep: set[Path]) -> None:
    for candidate in directory.glob("page-*.png"):
        if candidate not in keep:
            try:
                candidate.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# text


def run_text(
    declaration: Declaration,
    text: str,
    output: str,
    scale: int,
    background: str,
) -> None:
    if text == "":
        raise UsageError("텍스트가 빈 문자열입니다")
    if not declaration.unicode_map:
        raise DeclError("유니코드 매핑이 하나도 없어 텍스트를 그릴 수 없습니다")

    # Explicit policy: CLI argument/input newlines are line breaks, CRLF and
    # lone CR included.  No normalization or shaping of anything else.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    renderer = Renderer(declaration)
    renderer.check_textures()

    mapped_groups = {
        declaration.groups[name] for name, _ in declaration.unicode_map.values()
    }
    line_height = max(group.size[1] for group in mapped_groups)
    box_size = (
        max(group.size[0] for group in mapped_groups),
        max(group.size[1] for group in mapped_groups),
    )
    fallback = declaration.unicode_map.get(0)

    advances: list[int] = []
    for line in lines:
        width = 0
        for character in line:
            codepoint = ord(character)
            assignment = declaration.unicode_map.get(codepoint)
            if assignment is not None:
                width += declaration.groups[assignment[0]].size[0]
            elif fallback is not None:
                width += declaration.groups[fallback[0]].size[0]
            else:
                width += box_size[0]
        advances.append(width)

    width = max(1, max(advances))
    height = max(1, len(lines) * line_height)
    page = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    for row, line in enumerate(lines):
        x = 0
        y = row * line_height
        for character in line:
            codepoint = ord(character)
            assignment = declaration.unicode_map.get(codepoint)
            if assignment is not None:
                group_name, index = assignment
                _composite_at(page, renderer.glyph(group_name, index), x, y)
                x += declaration.groups[group_name].size[0]
            elif fallback is not None:
                group_name, index = fallback
                _composite_at(page, renderer.glyph(group_name, index), x, y)
                x += declaration.groups[group_name].size[0]
            else:
                ImageDraw.Draw(page).rectangle(
                    (x, y, x + box_size[0] - 1, y + box_size[1] - 1),
                    outline=(0, 0, 0, 255),
                )
                x += box_size[0]

    if background == "white":
        white = Image.new("RGBA", page.size, (255, 255, 255, 255))
        white.alpha_composite(page)
        page = white
    if scale != 1:
        page = page.resize(
            (page.width * scale, page.height * scale), Image.Resampling.NEAREST
        )
    _atomic_png(page, Path(output))
