from __future__ import annotations

import shutil
from pathlib import Path

from glyph_inspect.decl import parse_file

PROJECT_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = PROJECT_ROOT / "examples"
HANGUL_JSON = EXAMPLES / "hangul.json"
ASCII_JSON = EXAMPLES / "ascii.json"

# Independent 8x4x4 classification derived from docs/about_8x4x4.txt, not from the
# declaration's import lists.
NO_FINAL_INITIAL = {
    0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 20: 0,
    8: 1, 12: 1, 18: 1,
    13: 2, 17: 2,
    9: 3, 10: 3, 11: 3, 19: 3,
    14: 4, 15: 4, 16: 4,
}
WITH_FINAL_INITIAL = {
    0: 5, 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 20: 5,
    8: 6, 12: 6, 13: 6, 17: 6, 18: 6,
    9: 7, 10: 7, 11: 7, 14: 7, 15: 7, 16: 7, 19: 7,
}
FINAL_BATCH = {
    0: 0, 2: 0, 9: 0,
    4: 1, 6: 1, 11: 1, 14: 1, 16: 1, 19: 1, 20: 1,
    1: 2, 3: 2, 5: 2, 7: 2, 10: 2, 15: 2,
    8: 3, 12: 3, 13: 3, 17: 3, 18: 3,
}


def expected_groups(codepoint: int) -> list[str]:
    index = codepoint - 0xAC00
    lead, rest = divmod(index, 588)
    vowel, tail = divmod(rest, 28)
    names = ["hangul_syllables"]
    if tail == 0:
        names.append(f"initial_{NO_FINAL_INITIAL[vowel]}")
        names.append(f"medial_{0 if lead in (0, 15) else 1}")
    else:
        names.append(f"initial_{WITH_FINAL_INITIAL[vowel]}")
        names.append(f"medial_{2 if lead in (0, 15) else 3}")
        names.append(f"final_{FINAL_BATCH[vowel]}")
    return names


def test_ascii_example_and_combined_declaration():
    for path in (ASCII_JSON, HANGUL_JSON):
        declaration = parse_file(str(path))
        mapped = {
            codepoint for codepoint in declaration.unicode_map if codepoint < 0x80
        }
        assert mapped == set(range(0x20, 0x7F)), path


def test_list_and_groups_without_texture(tmp_path, run):
    copied = tmp_path / "hangul.json"
    shutil.copy(HANGUL_JSON, copied)
    assert not (tmp_path / "hangul.png").exists()

    listed = run("list", str(copied))
    assert listed.returncode == 0, listed.stderr
    lines = [
        line
        for line in listed.stdout.decode("utf-8").splitlines()
        if 0xAC00 <= int(line.split("\t")[0][2:], 16) <= 0xD7A3
    ]
    assert len(lines) == 11172
    assert lines[0] == "U+AC00\t가"
    assert lines[-1] == "U+D7A3\t힣"

    grouped = run("groups", str(copied))
    assert grouped.returncode == 0, grouped.stderr
    rows = [
        row
        for row in grouped.stdout.decode("utf-8").splitlines()
        if 0xAC00 <= int(row.split("\t")[0][2:], 16) <= 0xD7A3
    ]
    assert len(rows) == 11172
    assert rows[0] == "U+AC00\t가\thangul_syllables,initial_0,medial_0"
    assert rows[1].endswith(",final_0")
    by_codepoint = {row.split("\t")[0]: row.split("\t")[2] for row in rows}
    assert by_codepoint["U+B098"].split(",")[-1] == "medial_1"


def test_full_independent_8x4x4_classification(tmp_path):
    copied = tmp_path / "hangul.json"
    shutil.copy(HANGUL_JSON, copied)
    declaration = parse_file(str(copied))
    assert (
        len(
            [
                codepoint
                for codepoint in declaration.unicode_map
                if 0xAC00 <= codepoint <= 0xD7A3
            ]
        )
        == 11172
    )
    for codepoint in range(0xAC00, 0xD7A4):
        group_name, index = declaration.unicode_map[codepoint]
        assert group_name == "hangul_syllables"
        assert declaration.participating_groups(group_name, index) == expected_groups(
            codepoint
        ), f"U+{codepoint:04X}"


def test_parts_have_one_or_two_textured_layers_per_glyph(tmp_path):
    copied = tmp_path / "hangul.json"
    shutil.copy(HANGUL_JSON, copied)
    declaration = parse_file(str(copied))
    for codepoint in range(0xAC00, 0xD7A4):
        group_name, index = declaration.unicode_map[codepoint]
        parts = declaration.parts(group_name, index)
        tail = (codepoint - 0xAC00) % 28
        assert len(parts) == (3 if tail else 2), f"U+{codepoint:04X}"
        assert all(part["offset"] == [0, 0] for part in parts)
        assert len({part["group"] for part in parts}) == len(parts)
