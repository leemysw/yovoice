"""验证发布说明不会混入其他版本或静默生成空正文。"""

from pathlib import Path
import runpy
import unittest

extract_notes = runpy.run_path(str(Path(__file__).with_name("release-notes.py")))["extract_notes"]


class ReleaseNotesTest(unittest.TestCase):
    def test_version_boundaries_and_invalid_notes(self):
        changelog = "# Changelog\n\n## [Unreleased]\n\n- 后续变更\n\n## [0.1.4] - 2026-09-26\n\n### Added\n\n- 新功能\n\n## [0.1.3] - 2026-09-19\n\n- 旧功能\n"
        expected = "## [0.1.4] - 2026-09-26\n\n### Added\n\n- 新功能\n"
        self.assertEqual(extract_notes(changelog, "v0.1.4"), expected)
        self.assertEqual(extract_notes(changelog, "0.1.4"), expected)
        self.assertIn("旧功能", extract_notes(changelog, "v0.1.3"))
        self.assertIn("新功能", extract_notes(changelog.replace("[0.1.4]", "[0.1.4-rc.1]"), "v0.1.4-rc.1"))
        for text, tag in [(changelog, "v0.1.40"), (changelog, "Unreleased"),
                          (changelog + changelog, "v0.1.4"),
                          ("## [0.1.4] - 2026-09-26\n\n### Added\n", "v0.1.4")]:
            with self.subTest(tag=tag, text=text):
                with self.assertRaises(ValueError):
                    extract_notes(text, tag)

    def test_bilingual_notes_required_for_new_releases(self):
        notes = "## [0.1.7] - 2026-10-05\n\n### English\n\n- Remote speech service.\n\n### 简体中文\n\n- 远程语音服务。\n"
        self.assertEqual(extract_notes(notes, "v0.1.7"), notes)
        for invalid in (notes.replace("### English", "### Added"),
                        notes.replace("### 简体中文", "### 更新"),
                        notes.replace("- Remote speech service.", ""),
                        notes + "\n### English\n\n- Duplicate.\n"):
            with self.subTest(notes=invalid), self.assertRaises(ValueError):
                extract_notes(invalid, "v0.1.7")


if __name__ == "__main__":
    unittest.main()
