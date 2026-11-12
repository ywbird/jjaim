"""Texture loading and source-over glyph composition."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .decl import Declaration, Group
from .errors import ResourceError


class Renderer:
    def __init__(self, declaration: Declaration):
        self.declaration = declaration
        self._textures: dict[Path, Image.Image] = {}
        self._glyphs: dict[tuple[str, int], Image.Image] = {}
        self._checked = False

    # -- resources -----------------------------------------------------

    def texture_image(self, set_name: str, source: str) -> Image.Image:
        # parse_file validates both names before an image command can run.
        path = Path(self.declaration.texture_sets[set_name][source])
        if not path.is_absolute():
            path = self.declaration.directory / path
        path = path.resolve()
        cached = self._textures.get(path)
        if cached is not None:
            return cached
        if not path.is_file():
            raise ResourceError(f"텍스처 파일을 찾을 수 없습니다: {path}")
        try:
            with Image.open(path) as image:
                if image.format != "PNG":
                    raise ResourceError(
                        f"지원하지 않는 이미지 형식입니다 ({image.format}): {path}"
                    )
                image.load()
                rgba = image.convert("RGBA")
        except ResourceError:
            raise
        except UnidentifiedImageError:
            raise ResourceError(f"지원하지 않는 이미지 형식입니다: {path}") from None
        except OSError as exc:
            raise ResourceError(
                f"텍스처 파일을 읽을 수 없습니다: {path} ({exc.strerror})"
            ) from None
        self._textures[path] = rgba
        return rgba

    def check_textures(self) -> None:
        """Reject referenced crops outside their texture.  Mapping-reachable only."""
        if self._checked:
            return
        referenced: set[tuple[str, int]] = set(self.declaration.unicode_map.values())
        # Every import placement is a declaration-level reference, even when
        # the target index is not itself unicode-mapped.
        for group in self.declaration.groups.values():
            for placements in self.declaration.placement_map(group.name).values():
                for child, child_index, _ in placements:
                    referenced.add((child, child_index))
        for name, index in sorted(referenced, key=lambda item: (item[0], item[1])):
            group = self.declaration.groups[name]
            if group.texture is None:
                continue
            image = self.texture_image(group.texture.set, group.texture.source)
            x0, y0, x1, y1 = group.texture.crop_box(group.size, index)
            if x0 < 0 or y0 < 0 or x1 > image.width or y1 > image.height:
                raise ResourceError(
                    f"텍스처 절단 영역이 이미지 밖입니다: 그룹 {name}[{index}] "
                    f"({x0},{y0})-({x1},{y1}), 이미지 {image.width}x{image.height}"
                )
        self._checked = True

    # -- composition ---------------------------------------------------

    def glyph(self, name: str, index: int) -> Image.Image:
        key = (name, index)
        cached = self._glyphs.get(key)
        if cached is not None:
            return cached
        group = self.declaration.groups[name]
        if not 0 <= index < group.count:
            raise IndexError(f"{name}[{index}]")
        base = self._own_texture(group, index)
        for child, child_index, import_index in self.declaration.placement_map(name).get(
            index, ()
        ):
            layer = self.glyph(child, child_index)
            dx, dy = group.imports[import_index].offset
            _composite_at(base, layer, dx, dy)
        self._glyphs[key] = base
        return base

    def _own_texture(self, group: Group, index: int) -> Image.Image:
        canvas = Image.new("RGBA", group.size, (0, 0, 0, 0))
        if group.texture is None:
            return canvas
        image = self.texture_image(group.texture.set, group.texture.source)
        box = group.texture.crop_box(group.size, index)
        canvas.alpha_composite(image.crop(box), dest=(0, 0))
        return canvas


def _composite_at(base: Image.Image, layer: Image.Image, dx: int, dy: int) -> None:
    """Source-over ``layer`` onto ``base`` at (dx, dy), clipping both edges."""
    x0 = max(0, dx)
    y0 = max(0, dy)
    sx0 = max(0, -dx)
    sy0 = max(0, -dy)
    width = min(layer.width - sx0, base.width - x0)
    height = min(layer.height - sy0, base.height - y0)
    if width <= 0 or height <= 0:
        return
    if sx0 or sy0 or width != layer.width or height != layer.height:
        layer = layer.crop((sx0, sy0, sx0 + width, sy0 + height))
    base.alpha_composite(layer, dest=(x0, y0))
