"""Strict declaration parsing, validation and structural queries.

The declaration format is the JSON form of the texture-set/group/import/unicode
model in the repository-root SPEC.md. All coordinates are logical integer pixels.
"""

from __future__ import annotations

import itertools
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from .errors import DeclError

DIRECTIONS = ("right", "left", "down", "up")
_CODEPOINT_RE = re.compile(r"^U\+([0-9A-Fa-f]+)$")

GROUP_FIELDS = {"description", "size", "count", "texture", "imports", "unicode"}
TEXTURE_FIELDS = {"set", "source", "start", "direction"}
IMPORT_FIELDS = {"group", "offset", "at"}
AT_FIELDS = {"from", "to", "repeat"}
AXIS_FIELDS = {"count", "from_stride", "to_stride"}
UNICODE_FIELDS = {"from", "to"}


@dataclass(frozen=True)
class Texture:
    set: str
    source: str
    start: tuple[int, int]
    direction: str

    def step(self, size: tuple[int, int]) -> tuple[int, int]:
        w, h = size
        return {
            "right": (w, 0),
            "left": (-w, 0),
            "down": (0, h),
            "up": (0, -h),
        }[self.direction]

    def crop_box(self, size: tuple[int, int], index: int) -> tuple[int, int, int, int]:
        sx, sy = self.step(size)
        x = self.start[0] + index * sx
        y = self.start[1] + index * sy
        return (x, y, x + size[0], y + size[1])


@dataclass(frozen=True)
class Axis:
    count: int
    from_stride: int
    to_stride: int


@dataclass(frozen=True)
class At:
    a: int
    b: int
    to: int
    repeat: tuple[Axis, ...] = ()

    def expansions(self) -> Iterable[tuple[int, int]]:
        """Yield (source index, destination index) in repeat-index order."""
        axes = self.repeat
        for combo in itertools.product(*(range(ax.count) for ax in axes)):
            source_shift = sum(k * ax.from_stride for k, ax in zip(combo, axes))
            target_shift = sum(k * ax.to_stride for k, ax in zip(combo, axes))
            for j in range(self.b - self.a):
                yield (self.a + j + source_shift, self.to + j + target_shift)


@dataclass(frozen=True)
class Import:
    group: str
    offset: tuple[int, int]
    at: tuple[At, ...]


@dataclass(frozen=True)
class UnicodeRange:
    a: int
    b: int
    to: int


@dataclass(frozen=True)
class Group:
    name: str
    size: tuple[int, int]
    count: int
    texture: Texture | None
    imports: tuple[Import, ...]
    unicode: tuple[UnicodeRange, ...]
    description: str | None = None


@dataclass
class Declaration:
    path: Path
    groups: dict[str, Group]
    texture_sets: dict[str, dict[str, str]] = field(default_factory=dict)
    unicode_map: dict[int, tuple[str, int]] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)
    _placement_cache: dict[str, dict[int, list[tuple[str, int, int]]]] = field(
        default_factory=dict, repr=False
    )

    @property
    def directory(self) -> Path:
        return self.path.parent

    def placement_map(self, group_name: str) -> dict[int, list[tuple[str, int, int]]]:
        """Map target index -> [(child group, child index, import number)].

        The order is import declaration order, then at declaration order, then
        the expansion order documented on ``At``.
        """
        cached = self._placement_cache.get(group_name)
        if cached is not None:
            return cached
        group = self.groups[group_name]
        result: dict[int, list[tuple[str, int, int]]] = {}
        for import_index, imp in enumerate(group.imports):
            for source, target in _expand_import(imp):
                result.setdefault(target, []).append((imp.group, source, import_index))
        self._placement_cache[group_name] = result
        return result

    def participating_groups(self, group_name: str, index: int) -> list[str]:
        """Structurally participating groups, root first, first visit wins."""
        ordered: list[str] = [group_name]
        seen = {group_name}

        def visit(name: str, glyph_index: int) -> None:
            for child, child_index, _ in self.placement_map(name).get(glyph_index, ()):
                if child not in seen:
                    seen.add(child)
                    ordered.append(child)
                visit(child, child_index)

        visit(group_name, index)
        return ordered

    def parts(self, group_name: str, index: int) -> list[dict[str, object]]:
        """Texture-bearing layer occurrences in actual layer order."""
        out: list[dict[str, object]] = []

        def visit(name: str, glyph_index: int, ox: int, oy: int) -> None:
            group = self.groups[name]
            if group.texture is not None:
                out.append({"group": name, "index": glyph_index, "offset": [ox, oy]})
            for child, child_index, import_index in self.placement_map(name).get(
                glyph_index, ()
            ):
                dx, dy = group.imports[import_index].offset
                visit(child, child_index, ox + dx, oy + dy)

        visit(group_name, index, 0, 0)
        return out


def _expand_import(imp: Import) -> Iterable[tuple[int, int]]:
    for at in imp.at:
        yield from at.expansions()


def _fail(path: str, message: str) -> None:
    raise DeclError(f"{path}: {message}")


def _expect_object(value: object, path: str) -> dict:
    if not isinstance(value, dict):
        _fail(path, "객체여야 합니다")
    return value


def _expect_list(value: object, path: str) -> list:
    if not isinstance(value, list):
        _fail(path, "배열이어야 합니다")
    return value


def _expect_string(value: object, path: str) -> str:
    if not isinstance(value, str) or not value:
        _fail(path, "비어 있지 않은 문자열이어야 합니다")
    return value


def _expect_int(value: object, path: str) -> int:
    if type(value) is not int:
        _fail(path, "정수여야 합니다")
    return value


def _expect_positive_int(value: object, path: str) -> int:
    number = _expect_int(value, path)
    if number <= 0:
        _fail(path, "양의 정수여야 합니다")
    return number


def _expect_point(value: object, path: str) -> tuple[int, int]:
    items = _expect_list(value, path)
    if len(items) != 2:
        _fail(path, "길이 2의 정수 좌표여야 합니다")
    return (_expect_int(items[0], f"{path}[0]"), _expect_int(items[1], f"{path}[1]"))


def _expect_range(value: object, path: str) -> tuple[int, int]:
    a, b = _expect_point(value, path)
    if a < 0:
        _fail(path, "시작 인덱스는 0 이상이어야 합니다")
    if b <= a:
        _fail(path, "빈 범위이거나 역방향 범위입니다")
    return a, b


def _reject_unknown(obj: dict, allowed: set[str], path: str) -> None:
    for key in obj:
        if key not in allowed:
            _fail(f"{path}.{key}", "알 수 없는 필드입니다 (unknown field)")


def _parse_texture_sets(value: object) -> dict[str, dict[str, str]]:
    sets = _expect_object(value, "$.texture_sets")
    parsed: dict[str, dict[str, str]] = {}
    for set_name, sources in sets.items():
        _expect_string(set_name, "$.texture_sets.<name>")
        set_path = f"$.texture_sets.{set_name}"
        members = _expect_object(sources, set_path)
        parsed[set_name] = {}
        for source_name, image_path in members.items():
            _expect_string(source_name, f"{set_path}.<name>")
            parsed[set_name][source_name] = _expect_string(
                image_path, f"{set_path}.{source_name}"
            )
    return parsed


def _parse_texture(value: object, path: str) -> Texture:
    obj = _expect_object(value, path)
    _reject_unknown(obj, TEXTURE_FIELDS, path)
    for required in ("set", "source", "start", "direction"):
        if required not in obj:
            _fail(path, f"필수 필드 '{required}'가 없습니다")
    direction = _expect_string(obj["direction"], f"{path}.direction")
    if direction not in DIRECTIONS:
        _fail(f"{path}.direction", "right|left|down|up 중 하나여야 합니다")
    return Texture(
        set=_expect_string(obj["set"], f"{path}.set"),
        source=_expect_string(obj["source"], f"{path}.source"),
        start=_expect_point(obj["start"], f"{path}.start"),
        direction=direction,
    )


def _parse_axis(value: object, path: str, span: int) -> Axis:
    obj = _expect_object(value, path)
    _reject_unknown(obj, AXIS_FIELDS, path)
    if "count" not in obj:
        _fail(path, "필수 필드 'count'가 없습니다")
    return Axis(
        count=_expect_positive_int(obj["count"], f"{path}.count"),
        from_stride=_expect_int(obj.get("from_stride", 0), f"{path}.from_stride"),
        to_stride=_expect_int(obj.get("to_stride", span), f"{path}.to_stride"),
    )


def _parse_at(value: object, path: str) -> At:
    obj = _expect_object(value, path)
    _reject_unknown(obj, AT_FIELDS, path)
    for required in ("from", "to"):
        if required not in obj:
            _fail(path, f"필수 필드 '{required}'가 없습니다")
    a, b = _expect_range(obj["from"], f"{path}.from")
    to = _expect_int(obj["to"], f"{path}.to")
    if to < 0:
        _fail(f"{path}.to", "0 이상이어야 합니다")
    repeat_values = _expect_list(obj.get("repeat", []), f"{path}.repeat")
    axes = tuple(
        _parse_axis(item, f"{path}.repeat[{i}]", b - a)
        for i, item in enumerate(repeat_values)
    )
    return At(a=a, b=b, to=to, repeat=axes)


def _parse_import(value: object, path: str) -> Import:
    obj = _expect_object(value, path)
    _reject_unknown(obj, IMPORT_FIELDS, path)
    for required in ("group", "offset", "at"):
        if required not in obj:
            _fail(path, f"필수 필드 '{required}'가 없습니다")
    ats = tuple(
        _parse_at(item, f"{path}.at[{i}]")
        for i, item in enumerate(_expect_list(obj["at"], f"{path}.at"))
    )
    return Import(
        group=_expect_string(obj["group"], f"{path}.group"),
        offset=_expect_point(obj["offset"], f"{path}.offset"),
        at=ats,
    )


def parse_codepoint(value: object, path: str) -> int:
    text = _expect_string(value, path)
    match = _CODEPOINT_RE.match(text)
    if match is None:
        _fail(path, "U+XXXX 형식의 코드 포인트여야 합니다")
    codepoint = int(match.group(1), 16)
    if codepoint > 0x10FFFF:
        _fail(path, "유니코드 범위를 벗어났습니다")
    if 0xD800 <= codepoint <= 0xDFFF:
        _fail(path, "서로게이트는 유효한 스칼라 값이 아닙니다")
    return codepoint


def _parse_unicode(value: object, path: str) -> UnicodeRange:
    obj = _expect_object(value, path)
    _reject_unknown(obj, UNICODE_FIELDS, path)
    for required in ("from", "to"):
        if required not in obj:
            _fail(path, f"필수 필드 '{required}'가 없습니다")
    a, b = _expect_range(obj["from"], f"{path}.from")
    to = parse_codepoint(obj["to"], f"{path}.to")
    last = to + (b - a) - 1
    if last > 0x10FFFF:
        _fail(path, "유니코드 범위를 벗어났습니다")
    if to <= 0xDFFF and last >= 0xD800:
        _fail(path, "서로게이트를 포함한 범위입니다")
    return UnicodeRange(a=a, b=b, to=to)


def _parse_group(name: str, value: object) -> Group:
    path = f"groups.{name}"
    obj = _expect_object(value, path)
    _reject_unknown(obj, GROUP_FIELDS, path)
    for required in ("size", "count"):
        if required not in obj:
            _fail(path, f"필수 필드 '{required}'가 없습니다")
    width, height = _expect_point(obj["size"], f"{path}.size")
    if width <= 0 or height <= 0:
        _fail(f"{path}.size", "양의 정수 크기여야 합니다")
    count = _expect_positive_int(obj["count"], f"{path}.count")
    description = obj.get("description")
    if "description" in obj and not isinstance(description, str):
        _fail(f"{path}.description", "문자열이어야 합니다")
    texture = (
        _parse_texture(obj["texture"], f"{path}.texture")
        if "texture" in obj
        else None
    )
    imports = tuple(
        _parse_import(item, f"{path}.imports[{i}]")
        for i, item in enumerate(_expect_list(obj.get("imports", []), f"{path}.imports"))
    )
    unicode_ranges = tuple(
        _parse_unicode(item, f"{path}.unicode[{i}]")
        for i, item in enumerate(
            _expect_list(obj.get("unicode", []), f"{path}.unicode")
        )
    )
    return Group(
        name=name,
        size=(width, height),
        count=count,
        texture=texture,
        imports=imports,
        unicode=unicode_ranges,
        description=description,
    )


def _no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    obj: dict = {}
    for key, value in pairs:
        if key in obj:
            raise DeclError(f"JSON 중복 키입니다 (duplicate key): {key!r}")
        obj[key] = value
    return obj


def _reject_constant(value: str) -> None:
    raise DeclError(f"JSON에서 허용하지 않는 상수입니다: {value}")


def parse_file(path_text: str) -> Declaration:
    path = Path(path_text)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise DeclError(f"선언 파일을 읽을 수 없습니다: {path} ({exc.strerror})") from None
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise DeclError(f"선언 파일이 UTF-8이 아닙니다: {path}") from None
    try:
        document = json.loads(
            text,
            object_pairs_hook=_no_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except json.JSONDecodeError as exc:
        raise DeclError(
            f"{path}: 잘못된 JSON입니다 (줄 {exc.lineno}, 열 {exc.colno}: {exc.msg})"
        ) from None
    root = _expect_object(document, "$")
    _reject_unknown(root, {"metadata", "texture_sets", "groups"}, "$")
    if "groups" not in root:
        _fail("$", "필수 필드 'groups'가 없습니다")
    metadata = (
        _expect_object(root["metadata"], "$.metadata") if "metadata" in root else {}
    )
    for key in ("name", "version", "author"):
        if key in metadata and not isinstance(metadata[key], str):
            _fail(f"$.metadata.{key}", "문자열이어야 합니다")
    texture_sets = (
        _parse_texture_sets(root["texture_sets"]) if "texture_sets" in root else {}
    )
    group_objects = _expect_object(root["groups"], "$.groups")
    groups = {
        name: _parse_group(name, value) for name, value in group_objects.items()
    }
    declaration = Declaration(
        path=path, groups=groups, texture_sets=texture_sets, metadata=metadata
    )
    _validate(declaration)
    return declaration


def _validate(declaration: Declaration) -> None:
    # Texture references are checked structurally, without opening any image.
    for group in declaration.groups.values():
        texture = group.texture
        if texture is not None:
            sources = declaration.texture_sets.get(texture.set)
            if sources is None:
                _fail(
                    f"groups.{group.name}.texture.set",
                    f"존재하지 않는 텍스처셋입니다: {texture.set!r}",
                )
            if texture.source not in sources:
                _fail(
                    f"groups.{group.name}.texture.source",
                    f"텍스처셋 {texture.set!r}에 없는 소스입니다: {texture.source!r}",
                )

    # References, ranges, cycles.
    for group in declaration.groups.values():
        for import_index, imp in enumerate(group.imports):
            child = declaration.groups.get(imp.group)
            if child is None:
                _fail(
                    f"groups.{group.name}.imports[{import_index}].group",
                    f"존재하지 않는 그룹입니다: {imp.group!r}",
                )
            for at_index, at in enumerate(imp.at):
                if at.b > child.count:
                    _fail(
                        f"groups.{group.name}.imports[{import_index}].at[{at_index}].from",
                        f"원본 그룹 {child.name!r}의 인덱스 범위를 벗어났습니다",
                    )
                for source, target in at.expansions():
                    if not 0 <= source < child.count:
                        _fail(
                            f"groups.{group.name}.imports[{import_index}].at[{at_index}]",
                            f"반복을 편 원본 인덱스 {source}가 그룹 {child.name!r}의 범위를 벗어났습니다",
                        )
                    if not 0 <= target < group.count:
                        _fail(
                            f"groups.{group.name}.imports[{import_index}].at[{at_index}]",
                            f"반복을 편 대상 인덱스 {target}가 그룹 {group.name!r}의 범위를 벗어났습니다",
                        )

    _check_cycles(declaration)

    mapping: dict[int, tuple[str, int]] = {}
    for group in declaration.groups.values():
        for range_index, item in enumerate(group.unicode):
            if item.b > group.count:
                _fail(
                    f"groups.{group.name}.unicode[{range_index}].from",
                    f"그룹 인덱스 범위를 벗어났습니다 (count={group.count})",
                )
            for offset in range(item.b - item.a):
                codepoint = item.to + offset
                assignment = (group.name, item.a + offset)
                previous = mapping.get(codepoint)
                if previous is None:
                    mapping[codepoint] = assignment
                elif previous != assignment:
                    _fail(
                        f"groups.{group.name}.unicode[{range_index}]",
                        f"U+{codepoint:04X} 충돌: {previous[0]}[{previous[1]}]와 "
                        f"{assignment[0]}[{assignment[1]}]",
                    )
    declaration.unicode_map = mapping


def _check_cycles(declaration: Declaration) -> None:
    state: dict[str, int] = {}

    def visit(name: str, trail: list[str]) -> None:
        marker = state.get(name, 0)
        if marker == 1:
            cycle = " -> ".join(trail[trail.index(name) :] + [name])
            raise DeclError(f"임포트 순환 참조입니다: {cycle}")
        if marker == 2:
            return
        state[name] = 1
        trail.append(name)
        for imp in declaration.groups[name].imports:
            visit(imp.group, trail)
        trail.pop()
        state[name] = 2

    for name in declaration.groups:
        visit(name, [])
