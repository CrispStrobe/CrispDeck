import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class AndroidSigningTests(unittest.TestCase):
    def test_tauri_kotlin_release_block_is_signed_and_patch_is_repeatable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'build.gradle.kts'
            path.write_text('android {\n buildTypes {\n getByName("debug") { }\n getByName("release") { isMinifyEnabled = true }\n }\n}')
            env = dict(os.environ, ANDROID_KEYSTORE_PATH='/tmp/release.keystore',
                       ANDROID_KEYSTORE_PASSWORD='test$pass"word', ANDROID_KEY_ALIAS='release', ANDROID_KEY_PASSWORD='test')
            command = [sys.executable, 'scripts/patch-android-signing.py', str(path)]
            subprocess.run(command, env=env, check=True, capture_output=True)
            first = path.read_text()
            self.assertIn('getByName("release") {\n            signingConfig = signingConfigs.getByName("release")', first)
            self.assertIn('test\\$pass\\"word', first)
            subprocess.run(command, env=env, check=True, capture_output=True)
            self.assertEqual(path.read_text(), first)

    def test_unrecognized_release_block_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'build.gradle.kts'
            path.write_text('android { buildTypes { } }')
            result = subprocess.run([sys.executable, 'scripts/patch-android-signing.py', str(path)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
