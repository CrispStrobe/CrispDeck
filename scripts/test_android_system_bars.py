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

    def error_dialog(self, title, button_id='android:id/aerr_close', package='android'):
        return f'''<hierarchy><node package="{package}" resource-id="android:id/alertTitle" text="{title}"/>
          <node package="{package}" resource-id="{button_id}" enabled="true" clickable="true" bounds="[70,1170][1010,1296]"/>
          <node package="android" resource-id="android:id/aerr_wait" text="Wait" clickable="true"/></hierarchy>'''

    def test_only_the_known_emulator_launcher_anr_can_be_closed(self):
        node = smoke.emulator_launcher_close_node(self.error_dialog("Pixel Launcher isn't responding"))
        self.assertEqual(node.get('resource-id'), 'android:id/aerr_close')

    def test_crispdeck_and_other_system_anrs_fail_instead_of_being_dismissed(self):
        for title in ["CrispDeck isn't responding", "System UI isn't responding", 'CrispDeck keeps stopping']:
            with self.assertRaisesRegex(RuntimeError, 'Unexpected app/system error'):
                smoke.emulator_launcher_close_node(self.error_dialog(title))

    def test_launcher_dialog_requires_its_actual_system_close_control(self):
        with self.assertRaisesRegex(RuntimeError, 'unambiguous Close app'):
            smoke.emulator_launcher_close_node(self.error_dialog("Pixel Launcher isn't responding", 'android:id/aerr_wait'))

    def test_app_content_cannot_impersonate_an_emulator_error_dialog(self):
        self.assertIsNone(smoke.emulator_launcher_close_node(self.error_dialog("Pixel Launcher isn't responding", package=smoke.BUNDLE)))
