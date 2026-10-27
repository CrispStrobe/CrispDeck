import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mobile_smoke',
    Path(__file__).resolve().parents[1] / 'tools/validation/mobile_smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class AndroidSystemBarTests(unittest.TestCase):
    def test_checks_app_window_instead_of_other_system_windows(self):
        dump = '''WINDOW MANAGER WINDOWS
  Window #0 Window{abc u0 StatusBar}:
    mAttrs={apr=LIGHT_STATUS_BARS LIGHT_NAVIGATION_BARS}
  Window #1 Window{def u0 com.christianstrobele.crispdeck/.MainActivity}:
    mAttrs={ty=BASE_APPLICATION}
  Window #2 Window{ghi u0 NavigationBar}:
    mAttrs={apr=LIGHT_STATUS_BARS LIGHT_NAVIGATION_BARS}
'''
        self.assertEqual(smoke.android_bar_appearance(dump), {'status': False, 'navigation': False})

    def test_light_appearance_requires_both_native_bars(self):
        dump = f'''  Window #1 Window{{def u0 {smoke.BUNDLE}/.MainActivity}}:
    mAttrs={{ty=BASE_APPLICATION apr=LIGHT_STATUS_BARS}}
'''
        self.assertEqual(smoke.android_bar_appearance(dump), {'status': True, 'navigation': False})

    def test_missing_app_window_is_not_a_passing_dark_appearance(self):
        with self.assertRaisesRegex(RuntimeError, 'No CrispDeck window'):
            smoke.android_bar_appearance('WINDOW MANAGER WINDOWS\n')
