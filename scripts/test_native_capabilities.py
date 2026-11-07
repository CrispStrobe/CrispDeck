"""Keep native file access limited to user-selected export destinations."""
import json
from pathlib import Path
import unittest


CAPABILITIES = Path(__file__).resolve().parents[1] / 'src-tauri' / 'capabilities'
CONFIG = CAPABILITIES.parent / 'tauri.conf.json'


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
                self.assertFalse(any((permission if isinstance(permission, str) else
                                      permission.get('identifier', '')).startswith('store:')
                                     for permission in permissions),
                                 'The unused store plugin accepts arbitrary JSON file paths; '
                                 'do not bypass filesystem scopes through its commands')


class NativeContentSecurityPolicyTests(unittest.TestCase):
    def test_production_rejects_untrusted_scripts_and_active_documents(self):
        policy = json.loads(CONFIG.read_text())['app']['security']['csp']
        # Tauri hashes/nonces bundled scripts at compile time. Neither an
        # injected inline script nor a remote script needs permission here.
        self.assertIsInstance(policy, dict)
        self.assertEqual(policy['default-src'].split(), ["'self'"])
        self.assertEqual(policy['script-src'].split(), ["'self'"])
        for directive in ('frame-src', 'object-src', 'form-action'):
            self.assertEqual(policy[directive], "'none'")
        self.assertEqual(policy['base-uri'], "'self'")

    def test_media_workers_federation_and_native_ipc_remain_available(self):
        security = json.loads(CONFIG.read_text())['app']['security']
        for name in ('csp', 'devCsp'):
            with self.subTest(policy=name):
                policy = security[name]
                self.assertIn('blob:', policy['worker-src'].split(), 'HLS uses a blob worker')
                self.assertIn('ipc:', policy['connect-src'].split())
                for source in ('http:', 'https:', 'wss:'):
                    self.assertIn(source, policy['connect-src'].split(),
                                  'Federated servers and user-configured BYOK endpoints must work')
                for source in ('blob:', 'https:'):
                    self.assertIn(source, policy['media-src'].split())


if __name__ == '__main__':
    unittest.main()
