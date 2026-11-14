import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
SCRIPT = TOOLS / "generate_declaration.py"
EXAMPLES = ROOT / "examples"

sys.path.insert(0, str(TOOLS))
import generate_declaration  # noqa: E402

FIXTURES = {
    name: (EXAMPLES / name).read_bytes() for name in ("ascii.json", "hangul.json")
}


def fixture(name):
    return json.loads(FIXTURES[name].decode("utf-8"))


def run_cli(*args, cwd=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=cwd,
    )


class BaselineTests(unittest.TestCase):
    def test_ascii_baseline_matches_fixture(self):
        self.assertEqual(
            generate_declaration.generate_declaration("ascii", 8, 16),
            fixture("ascii.json"),
        )

    def test_hangul_baseline_matches_fixture(self):
        self.assertEqual(
            generate_declaration.generate_declaration("hangul", 8, 16),
            fixture("hangul.json"),
        )


class LayoutTests(unittest.TestCase):
    def test_ascii_at_5x11(self):
        declaration = generate_declaration.generate_declaration("ascii", 5, 11)
        expected = fixture("ascii.json")
        self.assertEqual(
            list(declaration["groups"]), list(expected["groups"])
        )
        self.assertEqual(len(declaration["groups"]), 6)

        for row, (name, group) in enumerate(declaration["groups"].items()):
            with self.subTest(group=name):
                self.assertEqual(group["size"], [5, 11])
                self.assertEqual(
                    group["texture"]["start"], [0, (row + 2) * 11]
                )
                self.assertEqual(group["texture"]["direction"], "right")

        self.assertIn(
            "5x11", declaration["metadata"]["description"]
        )

    def test_hangul_at_5x11(self):
        original = fixture("hangul.json")
        declaration = generate_declaration.generate_declaration("hangul", 5, 11)
        self.assertEqual(
            list(declaration["groups"]), list(original["groups"])
        )

        ascii_groups = [
            name
            for name, group in declaration["groups"].items()
            if group.get("texture", {}).get("source") == "ascii"
        ]
        self.assertEqual(len(ascii_groups), 6)
        for row, name in enumerate(ascii_groups):
            group = declaration["groups"][name]
            with self.subTest(group=name):
                self.assertEqual(group["size"], [5, 11])
                self.assertEqual(
                    group["texture"]["start"], [0, (row + 2) * 11]
                )

        component_groups = [
            name
            for name, group in declaration["groups"].items()
            if group.get("texture", {}).get("source") == "hangul"
        ]
        self.assertEqual(len(component_groups), 16)
        for row, name in enumerate(component_groups):
            group = declaration["groups"][name]
            with self.subTest(group=name):
                self.assertEqual(group["size"], [10, 11])
                self.assertEqual(group["texture"]["start"], [0, row * 11])

        syllables = declaration["groups"]["hangul_syllables"]
        self.assertEqual(syllables["size"], [10, 11])
        self.assertNotIn("texture", syllables)

    def test_preserves_groups_mappings_and_metadata(self):
        for mode, name in (("ascii", "ascii.json"), ("hangul", "hangul.json")):
            original = fixture(name)
            generated = generate_declaration.generate_declaration(mode, 5, 11)
            with self.subTest(mode=mode):
                self.assertEqual(generated["texture_sets"], original["texture_sets"])
                self.assertEqual(
                    generated["metadata"]["name"], original["metadata"]["name"]
                )
                self.assertEqual(
                    generated["metadata"]["version"], original["metadata"]["version"]
                )
                self.assertEqual(
                    list(generated["groups"]), list(original["groups"])
                )
                for group_name, old in original["groups"].items():
                    new = generated["groups"][group_name]
                    for key in ("description", "count", "imports", "unicode"):
                        self.assertEqual(
                            new.get(key), old.get(key), f"{mode}:{group_name}:{key}"
                        )
                    if "texture" not in old:
                        continue
                    for key in ("set", "source", "direction"):
                        self.assertEqual(
                            new["texture"][key],
                            old["texture"][key],
                            f"{mode}:{group_name}:texture.{key}",
                        )

    def test_mapping_counts(self):
        ascii_declaration = generate_declaration.generate_declaration(
            "ascii", 5, 11
        )
        hangul_declaration = generate_declaration.generate_declaration(
            "hangul", 5, 11
        )

        def mapped(declaration):
            total = 0
            for group in declaration["groups"].values():
                for mapping in group.get("unicode", []):
                    start, end = mapping["from"]
                    total += end - start
            return total

        self.assertEqual(mapped(ascii_declaration), 95)
        self.assertEqual(mapped(hangul_declaration), 11267)


class CliTests(unittest.TestCase):
    def test_stdout_json(self):
        result = run_cli("--ascii", "5", "11")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            json.loads(result.stdout),
            generate_declaration.generate_declaration("ascii", 5, 11),
        )

    def test_file_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "declaration.json"
            result = run_cli("--hangul", "5", "11", "-o", str(output))
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                generate_declaration.generate_declaration("hangul", 5, 11),
            )

    def test_dash_is_stdout(self):
        result = run_cli("--ascii", "5", "11", "-o", "-")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(
            json.loads(result.stdout),
            generate_declaration.generate_declaration("ascii", 5, 11),
        )

    def test_templates_load_from_other_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_cli("--hangul", "5", "11", cwd=tmp)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(
                json.loads(result.stdout),
                generate_declaration.generate_declaration("hangul", 5, 11),
            )

    def test_help(self):
        result = run_cli("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--ascii", result.stdout)
        self.assertIn("--hangul", result.stdout)

    def test_invalid_dimensions(self):
        for value in ("0", "-1", "abc", "1.5"):
            with self.subTest(value=value):
                result = run_cli("--ascii", value, "16")
                self.assertEqual(result.returncode, 2)
                self.assertTrue(result.stderr)

        result = run_cli("--ascii", "8", "0")
        self.assertEqual(result.returncode, 2)
        self.assertTrue(result.stderr)

    def test_mode_required(self):
        result = run_cli("8", "16")
        self.assertEqual(result.returncode, 2)
        self.assertTrue(result.stderr)

    def test_modes_are_mutually_exclusive(self):
        result = run_cli("--ascii", "--hangul", "8", "16")
        self.assertEqual(result.returncode, 2)
        self.assertTrue(result.stderr)

    def test_no_arguments_is_usage_error(self):
        result = run_cli()
        self.assertEqual(result.returncode, 2)
        self.assertTrue(result.stderr)


class FixtureTests(unittest.TestCase):
    def test_examples_unchanged(self):
        for name, contents in FIXTURES.items():
            with self.subTest(fixture=name):
                self.assertEqual((EXAMPLES / name).read_bytes(), contents)


if __name__ == "__main__":
    unittest.main()
