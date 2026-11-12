"""Texture sets are source registries, independent of glyph extraction rules."""

from __future__ import annotations

import json
import shutil

import pytest
from PIL import Image

from conftest import write_decl
from glyph_inspect.decl import parse_file
from glyph_inspect.render import Renderer


@pytest.mark.parametrize(
    "registry,fragment",
    [
        ([], "texture_sets"),
        ({"main": []}, "main"),
        ({"": {"img": "a.png"}}, "<name>"),
        ({"main": {"": "a.png"}}, "<name>"),
        ({"main": {"img": ""}}, "img"),
        ({"main": {"img": 42}}, "img"),
        ({"main": {"img": {"path": "a.png"}}}, "img"),
    ],
)
def test_registry_accepts_only_named_image_path_strings(tmp_path, run, registry, fragment):
    path = tmp_path / "bad.json"
    path.write_text(
        json.dumps({"texture_sets": registry, "groups": {"G": {"size": [1, 1], "count": 1}}}),
        encoding="utf-8",
    )
    result = run("list", str(path))
    assert result.returncode == 3
    assert fragment.encode() in result.stderr
    assert b"Traceback" not in result.stderr


@pytest.mark.parametrize(
    "registry,texture,fragment",
    [
        ({}, {"set": "main", "source": "img", "start": [0, 0], "direction": "right"}, "main"),
        ({"main": {}}, {"set": "main", "source": "img", "start": [0, 0], "direction": "right"}, "img"),
        ({"main": {"img": "a.png"}}, {"source": "a.png", "start": [0, 0], "direction": "right"}, "set"),
        ({"main": {"img": "a.png"}}, {"set": "main", "source": "a.png", "start": [0, 0], "direction": "right"}, "a.png"),
        ({"main": {"img": "a.png"}, "other": {"alt": "b.png"}}, {"set": "other", "source": "img", "start": [0, 0], "direction": "right"}, "img"),
    ],
)
def test_texture_reference_must_resolve_structurally(
    tmp_path, run, registry, texture, fragment
):
    path = tmp_path / "bad.json"
    path.write_text(
        json.dumps({"texture_sets": registry, "groups": {"G": {
            "size": [1, 1], "count": 1, "texture": texture,
            "unicode": [{"from": [0, 1], "to": "U+0041"}],
        }}}),
        encoding="utf-8",
    )
    for command in ("list", "groups"):
        result = run(command, str(path))
        assert result.returncode == 3
        assert fragment.encode() in result.stderr
        assert b"Traceback" not in result.stderr


def test_duplicate_texture_source_names_are_rejected(tmp_path, run):
    path = tmp_path / "duplicate.json"
    path.write_text(
        '{"texture_sets":{"main":{"img":"a.png","img":"b.png"}},"groups":{}}',
        encoding="utf-8",
    )
    result = run("list", str(path))
    assert result.returncode == 3
    assert b"img" in result.stderr


def test_two_sources_in_one_set_and_same_source_name_in_second_set(tmp_path, run):
    red = (255, 0, 0, 255)
    blue = (0, 0, 255, 255)
    green = (0, 255, 0, 255)
    for name, color in (("red", red), ("blue", blue), ("green", green)):
        Image.new("RGBA", (1, 1), color).save(tmp_path / f"{name}.png")
    registry = {"main": {"red": "red.png", "blue": "blue.png", "unused": "missing.png"},
                "alternate": {"red": "green.png"}}
    groups = {}
    for name, set_name, source, codepoint in (
        ("A", "main", "red", "U+0041"),
        ("B", "main", "blue", "U+0042"),
        ("C", "alternate", "red", "U+0043"),
    ):
        groups[name] = {
            "size": [1, 1], "count": 1,
            "texture": {"set": set_name, "source": source,
                        "start": [0, 0], "direction": "right"},
            "unicode": [{"from": [0, 1], "to": codepoint}],
        }
    path = write_decl(tmp_path / "decl.json", groups, registry)
    declaration = parse_file(str(path))
    assert declaration.texture_sets == registry
    renderer = Renderer(declaration)
    renderer.check_textures()  # The unused source does not need to exist.
    for name, color in (("A", red), ("B", blue), ("C", green)):
        assert renderer.glyph(name, 0).getpixel((0, 0)) == color

    output = tmp_path / "text.png"
    result = run("text", str(path), "--text", "ABC", "--output", str(output),
                 "--scale", "1", "--background", "transparent")
    assert result.returncode == 0, result.stderr
    with Image.open(output) as image:
        assert image.size == (3, 1)
        assert [image.getpixel((i, 0)) for i in range(3)] == [red, blue, green]

    copied = tmp_path / "elsewhere" / "decl.json"
    copied.parent.mkdir()
    shutil.copy(path, copied)
    assert run("list", str(copied)).returncode == 0
    assert run("groups", str(copied)).returncode == 0
    missing = run("text", str(copied), "--text", "A", "--output",
                  str(copied.parent / "missing.png"))
    assert missing.returncode == 4
    assert b"red.png" in missing.stderr
