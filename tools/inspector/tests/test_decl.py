from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from conftest import make_block_png, write_decl

RED = (255, 0, 0, 255)
BLUE = (0, 0, 255, 255)


def base_groups(with_texture: bool = False) -> dict:
    group = {"size": [2, 2], "count": 2}
    if with_texture:
        group["texture"] = {
            "set": "main",
            "source": "tex",
            "start": [0, 0],
            "direction": "right",
        }
    group["unicode"] = [{"from": [0, 2], "to": "U+0041"}]
    return {"G": group}


def test_duplicate_json_key_is_rejected(tmp_path, run):
    path = tmp_path / "dup.json"
    path.write_text(
        '{"groups":{"G":{"size":[1,1],"count":1,"count":2}}}', encoding="utf-8"
    )
    result = run("list", str(path))
    assert result.returncode == 3
    assert b"\xed\x95\x9c" not in result.stderr  # no traceback marker
    assert b"Traceback" not in result.stderr
    assert b"duplicate" in result.stderr.lower() or "중복".encode() in result.stderr


def test_unknown_fields_and_types_are_rejected(tmp_path, run):
    groups = base_groups()
    groups["G"]["colour"] = "red"
    path = write_decl(tmp_path / "unknown.json", groups)
    result = run("list", str(path))
    assert result.returncode == 3
    assert b"colour" in result.stderr

    groups = base_groups()
    groups["G"]["count"] = True
    path = write_decl(tmp_path / "bool.json", groups)
    assert run("list", str(path)).returncode == 3

    groups = base_groups()
    groups["G"]["size"] = [1, 0]
    path = write_decl(tmp_path / "size.json", groups)
    assert run("list", str(path)).returncode == 3


def test_ranges_cycles_and_unicode_conflicts(tmp_path, run):
    cases: list[dict] = []

    groups = base_groups()
    groups["G"]["unicode"] = [{"from": [0, 3], "to": "U+0041"}]
    cases.append(groups)

    groups = base_groups()
    groups["G"]["unicode"] = [{"from": [1, 1], "to": "U+0041"}]
    cases.append(groups)

    groups = base_groups()
    groups["G"]["imports"] = [
        {"group": "G", "offset": [0, 0], "at": [{"from": [0, 1], "to": 0}]}
    ]
    cases.append(groups)

    groups = base_groups()
    groups["A"] = {
        "size": [2, 2],
        "count": 1,
        "imports": [{"group": "B", "offset": [0, 0], "at": [{"from": [0, 1], "to": 0}]}],
    }
    groups["B"] = {
        "size": [2, 2],
        "count": 1,
        "imports": [{"group": "A", "offset": [0, 0], "at": [{"from": [0, 1], "to": 0}]}],
    }
    cases.append(groups)

    groups = base_groups()
    groups["G"]["unicode"] = [{"from": [0, 2], "to": "U+D800"}]
    cases.append(groups)

    groups = base_groups()
    groups["H"] = {
        "size": [2, 2],
        "count": 1,
        "unicode": [{"from": [0, 1], "to": "U+0041"}],
    }
    cases.append(groups)

    groups = base_groups()
    groups["G"]["imports"] = [
        {
            "group": "G",
            "offset": [0, 0],
            "at": [
                {
                    "from": [0, 1],
                    "to": 0,
                    "repeat": [{"count": 3, "to_stride": 1}],
                }
            ],
        }
    ]
    cases.append(groups)

    for number, groups in enumerate(cases):
        path = write_decl(tmp_path / f"bad-{number}.json", groups)
        result = run("list", str(path))
        assert result.returncode == 3, (number, result.stderr)
        assert b"Traceback" not in result.stderr


def test_lists_survive_missing_texture_but_images_do_not(tmp_path, run):
    path = write_decl(tmp_path / "decl.json", base_groups(with_texture=True))
    assert run("list", str(path)).returncode == 0
    assert run("groups", str(path)).returncode == 0

    sheet = run("sheet", str(path), "--output", str(tmp_path / "sheet.png"))
    assert sheet.returncode == 4
    assert b"tex.png" in sheet.stderr
    assert not (tmp_path / "sheet.png").exists()

    text = run(
        "text", str(path), "--text", "AB", "--output", str(tmp_path / "text.png")
    )
    assert text.returncode == 4
    assert not (tmp_path / "text.png").exists()


def test_unsupported_image_format_is_reported(tmp_path, run):
    Image.new("RGB", (2, 2), (255, 0, 0)).save(tmp_path / "tex.gif", format="GIF")
    groups = base_groups(with_texture=True)
    path = write_decl(
        tmp_path / "decl.json", groups, {"main": {"tex": "tex.gif"}}
    )
    result = run("sheet", str(path), "--output", str(tmp_path / "sheet.png"))
    assert result.returncode == 4
    assert b"GIF" in result.stderr or "형식".encode() in result.stderr


def test_out_of_bounds_crop_is_rejected(tmp_path, run):
    make_block_png(tmp_path / "tex.png", [[RED, BLUE]])
    groups = base_groups(with_texture=True)
    groups["G"]["size"] = [4, 4]
    path = write_decl(tmp_path / "decl.json", groups)
    result = run("sheet", str(path), "--output", str(tmp_path / "sheet.png"))
    assert result.returncode == 4
    assert b"G[1]" in result.stderr or b"G" in result.stderr


def test_usage_errors(tmp_path, run):
    path = write_decl(tmp_path / "decl.json", base_groups())
    assert run("groups", str(path), "--parts").returncode == 2
    assert run("list", str(path), "--format", "xml").returncode == 2
    assert run("sheet", str(path), "--output", str(tmp_path / "a.png"), "--scale", "0").returncode == 2
    assert run("sheet", str(path)).returncode == 2
    assert run("text", str(path), "--output", str(tmp_path / "a.png")).returncode == 2
    assert (
        run(
            "text",
            str(path),
            "--text",
            "A",
            "--text-file",
            str(tmp_path / "x"),
            "--output",
            str(tmp_path / "a.png"),
        ).returncode
        == 2
    )


def test_output_path_errors_and_atomic_overwrite(tmp_path, run):
    path = write_decl(tmp_path / "decl.json", base_groups())
    missing = tmp_path / "missing" / "out.txt"
    assert run("list", str(path), "--output", str(missing)).returncode == 4

    output = tmp_path / "out.txt"
    first = run("list", str(path), "--output", str(output))
    assert first.returncode == 0
    content = output.read_text(encoding="utf-8")
    assert content == "U+0041\tA\nU+0042\tB\n"
    second = run("list", str(path), "--output", str(output))
    assert second.returncode == 0
    assert output.read_text(encoding="utf-8") == content


def test_list_escapes_unprintable_characters(tmp_path, run):
    groups = {
        "G": {
            "size": [1, 1],
            "count": 3,
            "unicode": [
                {"from": [0, 1], "to": "U+0000"},
                {"from": [1, 2], "to": "U+0009"},
                {"from": [2, 3], "to": "U+000A"},
            ],
        }
    }
    path = write_decl(tmp_path / "decl.json", groups)
    text = run("list", str(path))
    assert text.returncode == 0
    assert b"U+0000\t\\u0000\n" in text.stdout
    assert b"U+0009\t\\u0009\n" in text.stdout
    assert b"\x00" not in text.stdout

    as_json = run("list", str(path), "--format", "json")
    assert as_json.returncode == 0
    payload = json.loads(as_json.stdout)
    assert payload[0] == {"codepoint": "U+0000", "character": "\x00"}
    assert as_json.stdout.count(b"\n") == 1  # one compact JSON line


def test_missing_declaration_is_exit_3(tmp_path, run):
    result = run("list", str(tmp_path / "nope.json"))
    assert result.returncode == 3
    assert b"nope.json" in result.stderr


def test_descriptive_fields_are_preserved_and_validated(tmp_path, run):
    from glyph_inspect.decl import parse_file

    groups = base_groups()
    groups["G"]["description"] = "Two glyphs"
    path = tmp_path / "described.json"
    data = {
        "metadata": {
            "name": "Example",
            "version": "0.1",
            "author": "Test Author",
            "notes": {"source": "test"},
        },
        "groups": groups,
    }
    path.write_text(json.dumps(data), encoding="utf-8")
    declaration = parse_file(str(path))
    assert declaration.metadata == data["metadata"]
    assert declaration.groups["G"].description == "Two glyphs"
    assert run("list", str(path)).stdout == b"U+0041\tA\nU+0042\tB\n"

    # Omitting descriptive fields remains valid.
    bare = write_decl(tmp_path / "bare.json", base_groups())
    assert parse_file(str(bare)).metadata == {}
    assert parse_file(str(bare)).groups["G"].description is None

    for value, field in (
        ([], "metadata"),
        ({"name": 1}, "name"),
        ({"version": None}, "version"),
        ({"author": False}, "author"),
    ):
        data["metadata"] = value
        path.write_text(json.dumps(data), encoding="utf-8")
        result = run("list", str(path))
        assert result.returncode == 3
        assert field.encode() in result.stderr

    data["metadata"] = {"name": "Example"}
    for value in (None, 123, []):
        data["groups"]["G"]["description"] = value
        path.write_text(json.dumps(data), encoding="utf-8")
        result = run("list", str(path))
        assert result.returncode == 3
        assert b"description" in result.stderr
