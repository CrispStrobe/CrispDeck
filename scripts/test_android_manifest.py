import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('manifest_merge', Path(__file__).with_name('merge-android-manifest.py'))
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class AndroidManifestTests(unittest.TestCase):
    def test_preserves_generated_providers_icons_and_custom_oauth_permissions(self):
        seed = Path(__file__).parent.parent / 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'AndroidManifest.xml'
            target.write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android">
              <uses-permission android:name="android.permission.INTERNET"/>
              <application android:icon="@mipmap/ic_launcher">
                <provider android:name="androidx.core.content.FileProvider"/>
                <activity android:name=".MainActivity" android:configChanges="smallestScreenSize">
                  <intent-filter><action android:name="android.intent.action.MAIN"/>
                    <category android:name="android.intent.category.LAUNCHER"/></intent-filter>
                </activity>
              </application></manifest>''')
            manifest.merge(seed, target)
            root = ET.parse(target).getroot()
            self.assertNotIn('package', root.attrib)
            app = root.find('application')
            self.assertEqual(app.get(f'{{{manifest.ANDROID}}}icon'), '@mipmap/ic_launcher')
            self.assertEqual(app.find('provider').get(manifest.NAME), 'androidx.core.content.FileProvider')
            permissions = {p.get(manifest.NAME): p for p in root.findall('uses-permission')}
            self.assertIn('android.permission.READ_MEDIA_IMAGES', permissions)
            self.assertEqual(permissions['android.permission.READ_EXTERNAL_STORAGE'].get(f'{{{manifest.ANDROID}}}maxSdkVersion'), '32')
            activity = app.find('activity')
            self.assertEqual(activity.get(f'{{{manifest.ANDROID}}}launchMode'), 'singleTask')
            self.assertIn('smallestScreenSize', activity.get(f'{{{manifest.ANDROID}}}configChanges'))
            self.assertEqual(len(activity.findall('intent-filter')), 2)
            self.assertTrue(any(d.get(f'{{{manifest.ANDROID}}}scheme') == 'crispdeck' for d in activity.findall('intent-filter/data')))
            first = target.read_bytes()
            manifest.merge(seed, target)
            self.assertEqual(target.read_bytes(), first)


if __name__ == '__main__':
    unittest.main()
