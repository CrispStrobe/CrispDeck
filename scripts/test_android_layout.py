"""Regression checks for the independent native viewport acceptance check."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

VALIDATION = Path(__file__).resolve().parents[1] / 'tools' / 'validation'
spec = importlib.util.spec_from_file_location('android_layout_smoke', VALIDATION / 'android_layout_smoke.py')
layout = importlib.util.module_from_spec(spec)
with patch.object(sys, 'path', [str(VALIDATION), *sys.path]):
    spec.loader.exec_module(layout)


def native_dump(width=1080, height=2400, sources=None):
    if sources is None:
        sources = [('statusBars', (0, 0, 1080, 84), True),
                   ('navigationBars', (0, 2274, 1080, 2400), True),
                   ('ime', (0, 1480, 1080, 2400), False)]
    lines = [f'Display: mDisplayId=0\n  WindowInsetsStateController\n    InsetsState\n'
             f'      mDisplayFrame=Rect(0, 0 - {width}, {height})']
    for index, (kind, bounds, visible) in enumerate(sources):
        left, top, right, bottom = bounds
        lines.append(f'      InsetsSource id={index:x} type={kind} '
                     f'frame=[{left},{top}][{right},{bottom}] visible={str(visible).lower()} flags=')
    lines.append('    Control map:\n      none\n    InsetsSourceProviders:')
    return '\n'.join(lines)


def hierarchy(bounds, package=layout.smoke.BUNDLE):
    left, top, right, bottom = bounds
    return f'''<hierarchy><node package="{package}" class="android.widget.FrameLayout">
      <node package="{package}" class="android.webkit.WebView"
            bounds="[{left},{top}][{right},{bottom}]"/>
    </node></hierarchy>'''


class AndroidLayoutTests(unittest.TestCase):
    def test_three_button_insets_fit_the_actual_native_webview(self):
        result = layout.viewport_geometry(hierarchy((0, 84, 1080, 2274)), native_dump())
        self.assertEqual(result['safe_viewport'], [0, 84, 1080, 2274])
        self.assertFalse(result['ime_visible'])

    def test_screenshot_regression_navigation_bar_overlaps_webview(self):
        with self.assertRaisesRegex(RuntimeError, 'overlaps Android navigationBars'):
            layout.viewport_geometry(hierarchy((0, 84, 1080, 2400)), native_dump())

    def test_repeated_native_padding_cannot_pass_as_a_safe_layout(self):
        with self.assertRaisesRegex(RuntimeError, 'possible double padding'):
            layout.viewport_geometry(hierarchy((0, 168, 1080, 2148)), native_dump())

    def test_keyboard_and_navigation_overlap_is_reserved_once_then_restored(self):
        keyboard = native_dump(sources=[('statusBars', (0, 0, 1080, 84), True),
                                       ('navigationBars', (0, 2274, 1080, 2400), True),
                                       ('ime', (0, 1480, 1080, 2400), True)])
        result = layout.viewport_geometry(hierarchy((0, 84, 1080, 1480)), keyboard)
        self.assertTrue(result['ime_visible'])
        with self.assertRaisesRegex(RuntimeError, 'possible double padding'):
            layout.viewport_geometry(hierarchy((0, 84, 1080, 1354)), keyboard)
        with self.assertRaisesRegex(RuntimeError, 'possible double padding'):
            layout.viewport_geometry(hierarchy((0, 84, 1080, 1480)), native_dump())
        self.assertFalse(layout.viewport_geometry(hierarchy((0, 84, 1080, 2274)), native_dump())['ime_visible'])

    def test_landscape_reserves_side_cutout_and_side_navigation(self):
        dump = native_dump(2400, 1080, [('statusBars', (0, 0, 2400, 84), True),
                                       ('navigationBars', (2274, 0, 2400, 1080), True),
                                       ('displayCutout', (0, 0, 90, 1080), True)])
        self.assertEqual(layout.viewport_geometry(hierarchy((90, 84, 2274, 1080)), dump)['safe_viewport'],
                         [90, 84, 2274, 1080])

    def test_gesture_bar_uses_reported_height_not_three_button_constant(self):
        dump = native_dump(sources=[('statusBars', (0, 0, 1080, 84), True),
                                    ('navigationBars', (0, 2370, 1080, 2400), True)])
        self.assertEqual(layout.viewport_geometry(hierarchy((0, 84, 1080, 2370)), dump)['safe_viewport'],
                         [0, 84, 1080, 2370])

    def test_hidden_bars_do_not_reserve_stale_space(self):
        dump = native_dump(sources=[('statusBars', (0, 0, 1080, 84), True),
                                    ('navigationBars', (0, 2274, 1080, 2400), False)])
        self.assertEqual(layout.viewport_geometry(hierarchy((0, 84, 1080, 2400)), dump)['safe_viewport'],
                         [0, 84, 1080, 2400])

    def test_other_displays_and_stale_provider_frames_are_not_evidence(self):
        dump = native_dump() + '\n      InsetsSource id=4 type=ime frame=[0,0][1080,2400] visible=true\n'
        dump += native_dump(800, 600, [('statusBars', (0, 0, 800, 60), True)]).replace('mDisplayId=0', 'mDisplayId=1')
        self.assertEqual(layout.viewport_geometry(hierarchy((0, 84, 1080, 2274)), dump)['display'],
                         (0, 0, 1080, 2400))

    def test_missing_system_or_app_evidence_is_a_failure(self):
        with self.assertRaisesRegex(RuntimeError, 'default display'):
            layout.viewport_geometry(hierarchy((0, 84, 1080, 2274)), '')
        with self.assertRaisesRegex(RuntimeError, 'system-bar inset evidence'):
            layout.viewport_geometry(hierarchy((0, 0, 1080, 2400)), native_dump(sources=[]))
        with self.assertRaisesRegex(RuntimeError, 'native CrispDeck WebView'):
            layout.viewport_geometry(hierarchy((0, 84, 1080, 2274), package='com.android.chrome'), native_dump())


if __name__ == '__main__':
    unittest.main()
