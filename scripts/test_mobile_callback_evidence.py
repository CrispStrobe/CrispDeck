import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mobile_smoke',
    Path(__file__).resolve().parents[1] / 'tools/validation/mobile_smoke.py')
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class CallbackEvidenceTests(unittest.TestCase):
    def test_process_start_or_successful_url_open_is_not_delivery(self):
        for log in ['', 'CrispDeck v1.3.0 started', 'Open in CrispDeck?']:
            with self.assertRaisesRegex(RuntimeError, 'did not reach'):
                smoke.require_callback_delivery(log, 2)

    def test_both_callbacks_need_plugin_receipts(self):
        with self.assertRaisesRegex(RuntimeError, 'did not reach'):
            smoke.require_callback_delivery(smoke.CALLBACK_DELIVERED, 2)
        smoke.require_callback_delivery((smoke.CALLBACK_DELIVERED + '\n') * 2, 2)

    def test_android_requires_success_and_the_expected_activity(self):
        target = smoke.BUNDLE + '/.MainActivity'
        smoke.require_android_callback_result('Status: ok\nActivity: ' + target, target)
        smoke.require_android_callback_result('Status: ok\nActivity: ' + smoke.BUNDLE + '/' + smoke.BUNDLE + '.MainActivity', target)
        for result in ['Error: Activity not started', 'Status: timeout\nActivity: ' + target,
                       'Status: ok\nActivity: com.android.chrome/.Main', 'Status: ok']:
            with self.assertRaisesRegex(RuntimeError, 'did not confirm'):
                smoke.require_android_callback_result(result, target)
