import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('android_artifacts', Path(__file__).with_name('find-android-artifact.py'))
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class AndroidArtifactTests(unittest.TestCase):
    def touch(self, root, name):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'package fixture')
        return path

    def test_unsigned_intermediary_bundle_and_debug_output_are_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.touch(root, 'app/build/intermediates/intermediary_bundle/universalRelease/packageUniversalReleaseBundle/intermediary-bundle.aab')
            self.touch(root, 'app/build/outputs/bundle/universalDebug/app-universal-debug.aab')
            final = self.touch(root, 'app/build/outputs/bundle/universalRelease/app-universal-release.aab')
            self.assertEqual(artifacts.find_artifact(root, 'aab'), final)

    def test_only_final_signed_release_apk_is_selected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.touch(root, 'app/build/intermediates/apk/release/intermediate.apk')
            self.touch(root, 'app/build/outputs/apk/universal/debug/app-universal-debug.apk')
            self.touch(root, 'app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk')
            final = self.touch(root, 'app/build/outputs/apk/universal/release/app-universal-release.apk')
            self.assertEqual(artifacts.find_artifact(root, 'apk'), final)

    def test_missing_or_ambiguous_final_outputs_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'found 0'):
                artifacts.find_artifact(root, 'aab')
            self.touch(root, 'app/build/outputs/bundle/universalRelease/app.aab')
            self.touch(root, 'other/build/outputs/bundle/universalRelease/other.aab')
            with self.assertRaisesRegex(ValueError, 'found 2'):
                artifacts.find_artifact(root, 'aab')
