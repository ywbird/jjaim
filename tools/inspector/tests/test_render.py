from __future__ import annotations

from pathlib import Path

from glyph_inspect.decl import At, Axis, parse_file
from glyph_inspect.render import Renderer

from conftest import make_block_png, make_pixel_png, write_decl

RED = (255, 0, 0, 255)
BLUE = (0, 0, 255, 255)
GREEN = (0, 255, 0, 255)


def test_direction_crops(tmp_path: Path):
    blocks = [
        [(bx * 50 + 10, by * 50 + 10, 0, 255) for bx in range(4)]
        for by in range(4)
    ]
    make_block_png(tmp_path / "tex.png", blocks)

    expected = {
        "right": (0, 0, 2),
        "left": (6, 0, 2),
        "down": (0, 0, 2),
        "up": (0, 6, 2),
    }
    for direction, (sx, sy, index) in expected.items():
        groups = {
            "G": {
                "size": [2, 2],
                "count": 4,
                "texture": {
                    "set": "main", "source": "tex",
                    "start": [sx, sy],
                    "direction": direction,
                },
            }
        }
        declaration = parse_file(
            str(write_decl(tmp_path / f"{direction}.json", groups))
        )
        glyph = Renderer(declaration).glyph("G", index)
        if direction == "right":
            block = (2, 0)
        elif direction == "left":
            block = (1, 0)
        elif direction == "down":
            block = (0, 2)
        else:
            block = (0, 1)
        expected_color = blocks[block[1]][block[0]]
        assert glyph.getpixel((0, 0)) == expected_color
        assert glyph.getpixel((1, 1)) == expected_color


def test_repeat_axes_expansion_order():
    at = At(
        a=1,
        b=2,
        to=3,
        repeat=(Axis(2, 2, 4), Axis(2, 1, 1)),
    )
    assert list(at.expansions()) == [
        (1, 3),
        (2, 4),
        (3, 7),
        (4, 8),
    ]


def test_offsets_clipping_nesting_and_parts(tmp_path: Path):
    make_block_png(tmp_path / "b.png", [[RED, BLUE]])
    groups = {
        "B": {
            "size": [2, 2],
            "count": 2,
            "texture": {"set": "main", "source": "b", "start": [0, 0], "direction": "right"},
        },
        "A": {
            "size": [4, 4],
            "count": 3,
            "imports": [
                {
                    "group": "B",
                    "offset": [1, 1],
                    "at": [{"from": [0, 2], "to": 0}],
                },
                {
                    "group": "B",
                    "offset": [-1, 0],
                    "at": [{"from": [0, 1], "to": 2}],
                },
            ],
        },
        "C": {
            "size": [6, 6],
            "count": 1,
            "imports": [
                {
                    "group": "A",
                    "offset": [1, 1],
                    "at": [
                        {"from": [0, 1], "to": 0},
                        {"from": [1, 2], "to": 0},
                    ],
                },
                {
                    "group": "A",
                    "offset": [3, 0],
                    "at": [{"from": [0, 1], "to": 0}],
                },
            ],
            "unicode": [{"from": [0, 1], "to": "U+0041"}],
        },
        "D": {
            "size": [8, 8],
            "count": 1,
            "imports": [
                {
                    "group": "C",
                    "offset": [1, 1],
                    "at": [{"from": [0, 1], "to": 0}],
                }
            ],
        },
    }
    declaration = parse_file(str(write_decl(tmp_path / "decl.json", groups)))
    renderer = Renderer(declaration)

    a0 = renderer.glyph("A", 0)
    assert a0.getpixel((1, 1)) == RED
    assert a0.getpixel((2, 2)) == RED
    assert a0.getpixel((0, 0))[3] == 0

    a2 = renderer.glyph("A", 2)
    assert a2.getpixel((0, 0)) == RED
    assert a2.getpixel((1, 0))[3] == 0

    c0 = renderer.glyph("C", 0)
    assert c0.getpixel((2, 2)) == BLUE
    assert c0.getpixel((4, 1)) == RED

    d0 = renderer.glyph("D", 0)
    assert d0.getpixel((3, 3)) == BLUE
    assert d0.getpixel((5, 2)) == RED

    assert declaration.participating_groups("C", 0) == ["C", "A", "B"]
    parts = declaration.parts("C", 0)
    assert parts == [
        {"group": "B", "index": 0, "offset": [2, 2]},
        {"group": "B", "index": 1, "offset": [2, 2]},
        {"group": "B", "index": 0, "offset": [4, 1]},
    ]


def test_source_over_layer_order(tmp_path: Path):
    make_block_png(
        tmp_path / "b.png", [[(255, 0, 0, 128), (0, 0, 255, 128)]], block=2
    )
    groups = {
        "B": {
            "size": [2, 2],
            "count": 2,
            "texture": {"set": "main", "source": "b", "start": [0, 0], "direction": "right"},
        },
        "P": {
            "size": [2, 2],
            "count": 1,
            "imports": [
                {
                    "group": "B",
                    "offset": [0, 0],
                    "at": [{"from": [0, 1], "to": 0}],
                }
            ],
        },
        "Q": {
            "size": [2, 2],
            "count": 1,
            "imports": [
                {
                    "group": "B",
                    "offset": [0, 0],
                    "at": [{"from": [1, 2], "to": 0}],
                }
            ],
        },
        "R": {
            "size": [2, 2],
            "count": 1,
            "imports": [
                {
                    "group": "B",
                    "offset": [0, 0],
                    "at": [{"from": [0, 1], "to": 0}],
                },
                {
                    "group": "B",
                    "offset": [0, 0],
                    "at": [{"from": [1, 2], "to": 0}],
                },
            ],
        },
    }
    declaration = parse_file(str(write_decl(tmp_path / "decl.json", groups)))
    renderer = Renderer(declaration)
    red = renderer.glyph("P", 0).getpixel((0, 0))
    blue = renderer.glyph("Q", 0).getpixel((0, 0))
    red_then_blue = renderer.glyph("R", 0).getpixel((0, 0))
    assert red == (255, 0, 0, 128)
    assert blue == (0, 0, 255, 128)
    assert red_then_blue == (85, 0, 170, 192)

    swapped = {
        **groups,
        "S": {
            "size": [2, 2],
            "count": 1,
            "imports": list(reversed(groups["R"]["imports"])),
        },
    }
    declaration2 = parse_file(str(write_decl(tmp_path / "swapped.json", swapped)))
    blue_then_red = Renderer(declaration2).glyph("S", 0).getpixel((0, 0))
    assert blue_then_red == (170, 0, 85, 192)
    assert blue_then_red != red_then_blue


def test_parent_own_texture_is_first_layer(tmp_path: Path):
    make_block_png(tmp_path / "t.png", [[GREEN, RED]])
    groups = {
        "G": {
            "size": [2, 2],
            "count": 1,
            "texture": {"set": "main", "source": "t", "start": [0, 0], "direction": "right"},
            "imports": [
                {
                    "group": "B",
                    "offset": [0, 0],
                    "at": [{"from": [0, 1], "to": 0}],
                }
            ],
        },
        "B": {
            "size": [1, 1],
            "count": 1,
            "texture": {"set": "main", "source": "b", "start": [0, 0], "direction": "right"},
        },
    }
    make_pixel_png(tmp_path / "b.png", [[RED]])
    declaration = parse_file(str(write_decl(tmp_path / "decl.json", groups)))
    glyph = Renderer(declaration).glyph("G", 0)
    # The parent texture is the first layer; the import paints over it.
    assert glyph.getpixel((0, 0)) == RED
    assert glyph.getpixel((1, 1)) == GREEN
