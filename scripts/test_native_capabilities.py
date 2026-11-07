"""Keep native file access limited to user-selected export destinations."""
import json
from pathlib import Path
import unittest


CAPABILITIES = Path(__file__).resolve().parents[1] / 'src-tauri' / 'capabilities'


class NativeFileCapabilitiesTests(unittest.TestCase):
    def test_main_window_can_only_write_dialog_selected_exports(self):
        # Tauri's save dialog adds the chosen path to the runtime filesystem
        # scope. Static wildcard scopes would let a compromised webview read
        # credentials or overwrite unrelated files without the user's choice.
        # Capabilities are additive, so inspect every one targeting main.
        capabilities = [json.loads(path.read_text()) for path in CAPABILITIES.glob('*.json')]
        main = [entry for entry in capabilities if 'main' in entry.get('windows', [])]
        self.assertTrue(main)
        for capability in main:
            with self.subTest(capability=capability['identifier']):
                permissions = capability['permissions']
                file_permissions = [permission for permission in permissions
                                    if isinstance(permission, str) and permission.startswith('fs:')]
                self.assertEqual(file_permissions, ['fs:allow-write-text-file'])
                self.assertIn('dialog:allow-save', permissions)
                self.assertNotIn('dialog:default', permissions)
                self.assertFalse(any(isinstance(permission, dict) and
                                     permission.get('identifier', '').startswith('fs:')
                                     for permission in permissions),
                                 'File paths must be granted by the save dialog, not a static scope')


if __name__ == '__main__':
    unittest.main()
