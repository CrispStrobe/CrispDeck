#!/usr/bin/env python3
"""Native emulator/simulator startup checks; never claim physical-device or account validation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

BUNDLE = 'com.christianstrobele.crispdeck'
SCHEME = 'app.vercel.crispdeck'
CALLBACKS = [f'{SCHEME}:/oauth/callback?state=ci-native-smoke',
             f'{SCHEME}://oauth/mastodon?state=ci-native-smoke']
CALLBACK_DELIVERED = 'OAuth callback delivered to the running app'


def run(*args):
    return subprocess.check_output([str(arg) for arg in args], text=True)


def require_callback_delivery(log, count):
    if log.count(CALLBACK_DELIVERED) < count:
        raise RuntimeError('OS callbacks did not reach the running app deep-link plugin')


def ios_log_messages(log):
    messages = []
    for line in log.splitlines():
        try: item = json.loads(line)
        except json.JSONDecodeError: continue
        if isinstance(item, dict) and item.get('subsystem') == BUNDLE and isinstance(item.get('eventMessage'), str):
            messages.append(item['eventMessage'])
    return '\n'.join(messages)


def require_android_callback_result(result, component):
    status = re.search(r'(?m)^Status:\s*(\S+)', result)
    activity = re.search(r'(?m)^Activity:\s*(\S+)', result)
    def expanded(value):
        package, name = value.split('/', 1)
        return package + '/' + (package + name if name.startswith('.') else name)
    if status is None or status.group(1) != 'ok' or activity is None or expanded(activity.group(1)) != expanded(component):
        raise RuntimeError('Android did not confirm callback delivery to the installed activity')


def ios_callback_tests(identifier, output):
    """Use Apple's UI test runner to confirm any system Open prompt explicitly."""
    project = output / 'callback-runner'
    project.mkdir()
    shutil.copy(Path(__file__).with_name('ios_callback_tests.swift'), project / 'CallbackTests.swift')
    spec = {
        'name': 'CallbackSmoke',
        'settings': {'base': {'SWIFT_VERSION': '5.0', 'GENERATE_INFOPLIST_FILE': 'YES',
                              'CODE_SIGNING_ALLOWED': 'NO'}},
        'targets': {'CallbackTests': {'type': 'bundle.ui-testing', 'platform': 'iOS',
                                     'deploymentTarget': '16.4', 'sources': ['CallbackTests.swift'],
                                     'settings': {'base': {'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE + '.callback-tests'}}}},
        'schemes': {'CallbackSmoke': {'build': {'targets': {'CallbackTests': ['test']}},
                                     'test': {'targets': ['CallbackTests']}}},
    }
    (project / 'project.json').write_text(json.dumps(spec, indent=2) + '\n')
    subprocess.run(['xcodegen', 'generate', '--spec', str(project / 'project.json'),
                    '--project', str(project)], check=True)
    with (output / 'callback-ui-tests.log').open('w') as log:
        subprocess.run(['xcodebuild', 'test', '-project', str(project / 'CallbackSmoke.xcodeproj'),
                        '-scheme', 'CallbackSmoke', '-destination', f'platform=iOS Simulator,id={identifier}',
                        '-derivedDataPath', str(output.parent / 'ios-callback-derived-data'),
                        '-resultBundlePath', str(output / 'callback-ui-tests.xcresult'),
                        '-parallel-testing-enabled', 'NO', 'CODE_SIGNING_ALLOWED=NO'],
                       stdout=log, stderr=subprocess.STDOUT, check=True, timeout=360)


def android_bar_appearance(dump):
    windows = re.split(r'(?m)^\s*Window #\d+ ', dump)
    window = next((block for block in windows if block.strip() and BUNDLE + '/' in block.splitlines()[0]
                   and 'mAttrs=' in block), None)
    if window is None:
        raise RuntimeError('No CrispDeck window attributes in the Android system-bar dump')
    return {name: bool(re.search(r'\b' + flag + r'\b', window)) for name, flag in
            [('status', 'LIGHT_STATUS_BARS'), ('navigation', 'LIGHT_NAVIGATION_BARS')]}


def android_node_center(node):
    bounds = list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))
    if len(bounds) != 4 or min(bounds) < 0 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        raise RuntimeError('Android control has no visible tappable bounds')
    return (bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2


def emulator_launcher_close_node(xml):
    nodes = list(ET.fromstring(xml).iter('node'))
    errors = [node.get('text', '') for node in nodes if node.get('package') == 'android'
              and node.get('resource-id') == 'android:id/alertTitle'
              and re.search(r"isn't responding|keeps stopping|has stopped", node.get('text', ''))]
    if not errors: return None
    if errors != ["Pixel Launcher isn't responding"]:
        raise RuntimeError(f'Unexpected app/system error dialog: {errors}')
    buttons = [node for node in nodes if node.get('package') == 'android'
               and node.get('resource-id') == 'android:id/aerr_close'
               and node.get('enabled') == 'true' and node.get('clickable') == 'true']
    if len(buttons) != 1:
        raise RuntimeError('The emulator launcher error has no unambiguous Close app control')
    return buttons[0]


def android_hierarchy(output, automation, stage, incidents):
    for attempt in range(4):
        xml = automation.dump_hierarchy(compressed=False)
        (output / f'ui-{stage}-{attempt}.xml').write_text(xml)
        close = emulator_launcher_close_node(xml)
        if close is None: return xml
        if len(incidents) >= 3:
            raise RuntimeError('The emulator launcher remained unstable after three recoveries')
        with (output / f'emulator-launcher-anr-{len(incidents) + 1}.png').open('wb') as file:
            subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True)
        incidents.append({'stage': stage, 'dialog': "Pixel Launcher isn't responding", 'action': 'Close app'})
        automation.click(*android_node_center(close))
        time.sleep(1)
    raise RuntimeError('The emulator launcher error did not close')


def android_theme_check(output, name, light, automation, incidents):
    android_hierarchy(output, automation, name, incidents)
    if automation.app_current()['package'] != BUNDLE:
        raise RuntimeError(f'CrispDeck is not the foreground app during {name}')
    dump = run('adb', 'shell', 'dumpsys', 'window', 'windows')
    (output / f'window-{name}.log').write_text(dump)
    appearance = android_bar_appearance(dump)
    if appearance != {'status': light, 'navigation': light}:
        raise RuntimeError(f'Android {name} system-bar appearance is {appearance}, expected light={light}')
    with (output / f'theme-{name}.png').open('wb') as file:
        subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True)


def android_toggle_theme(output, automation, transition, incidents):
    # Keep one UiAutomation service connected across launches. Starting a fresh
    # `uiautomator dump` process for each query can miss WebView virtual nodes.
    for attempt in range(6):
        xml = android_hierarchy(output, automation, f'{transition}-{attempt}', incidents)
        (output / f'theme-controls-{transition}-{attempt}.xml').write_text(xml)
        controls = [node for node in ET.fromstring(xml).iter('node')
                    if node.get('content-desc') == 'Toggle theme' or node.get('text') == 'Toggle theme']
        if controls:
            break
        time.sleep(1)
    if len(controls) != 1:
        raise RuntimeError(f'Expected one accessible theme toggle, found {len(controls)}')
    automation.click(*android_node_center(controls[0]))
    time.sleep(2)


def android(root, output, diagnostic=False):
    import uiautomator2
    receipt = json.loads((root / 'receipt-android.json').read_text())
    version = receipt['version']
    validator = run('git', 'rev-parse', 'HEAD').strip()
    if receipt.get('platform') != 'android' or not re.fullmatch(r'\d+\.\d+\.\d+', version) or not re.fullmatch(r'[0-9a-f]{40}', receipt['commit']):
        raise ValueError('Invalid Android package source receipt')
    if not diagnostic and (receipt['commit'] != validator or version != json.loads(Path('package.json').read_text())['version']):
        raise ValueError('Android package and validator must use the same release source')
    apk = root / f'CrispDeck_{version}_android_release.apk'
    with apk.open('rb') as file: digest = hashlib.file_digest(file, 'sha256').hexdigest()
    if receipt['assets'][apk.name]['sha256'] != digest:
        raise ValueError('APK changed after its package receipt was created')
    automation = uiautomator2.connect()
    # Start the persistent accessibility service before the app creates its WebView.
    (output / 'automation-device.json').write_text(json.dumps(automation.info, indent=2) + '\n')
    incidents = []
    android_hierarchy(output, automation, 'emulator-before-install', incidents)
    subprocess.run(['adb', 'logcat', '-c'], check=True)
    subprocess.run(['adb', 'install', '-r', str(apk)], check=True)
    info = run('adb', 'shell', 'dumpsys', 'package', BUNDLE)
    if f'versionName={version}' not in info:
        raise ValueError('Installed Android package has the wrong version')
    component = run('adb', 'shell', 'cmd', 'package', 'resolve-activity', '--brief', BUNDLE).strip().splitlines()[-1]
    if not component.startswith(BUNDLE + '/'):
        raise ValueError('Installed app has no launchable activity')
    def launch():
        subprocess.run(['adb', 'shell', 'am', 'start', '-W', '-n', component], check=True)
        for _ in range(12):
            time.sleep(1)
            if not run('adb', 'shell', 'pidof', BUNDLE).strip():
                raise RuntimeError('Android app exited during native startup')
        activity = run('adb', 'shell', 'dumpsys', 'activity', 'activities')
        if not any(BUNDLE in line and ('ResumedActivity' in line or 'topResumedActivity' in line) for line in activity.splitlines()):
            raise RuntimeError('Android activity was not visible/resumed')
    try:
        launch()
        subprocess.run(['adb', 'shell', 'am', 'force-stop', BUNDLE], check=True)
        launch()
        with (output / 'native-startup.png').open('wb') as file:
            subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True)
        android_theme_check(output, 'dark', False, automation, incidents)
        android_toggle_theme(output, automation, 'dark-to-oled', incidents)
        android_theme_check(output, 'oled', False, automation, incidents)
        android_toggle_theme(output, automation, 'oled-to-light', incidents)
        android_theme_check(output, 'light', True, automation, incidents)
        subprocess.run(['adb', 'shell', 'am', 'force-stop', BUNDLE], check=True)
        launch()
        android_theme_check(output, 'light-restarted', True, automation, incidents)
        android_toggle_theme(output, automation, 'light-to-dark', incidents)
        android_theme_check(output, 'dark-restored', False, automation, incidents)
        pid = run('adb', 'shell', 'pidof', BUNDLE).strip()
        for index, uri in enumerate(CALLBACKS):
            args = ['-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.BROWSABLE', '-d', uri]
            target = run('adb', 'shell', 'cmd', 'package', 'resolve-activity', '--brief', *args).strip().splitlines()[-1]
            if target != component:
                raise RuntimeError(f'Android OAuth callback resolves to another activity: {target}')
            result = run('adb', 'shell', 'am', 'start', '-W', *args)
            (output / f'oauth-callback-{index}.log').write_text(result)
            require_android_callback_result(result, component)
            time.sleep(2)
            android_hierarchy(output, automation, f'oauth-callback-{index}', incidents)
            if run('adb', 'shell', 'pidof', BUNDLE).strip() != pid or automation.app_current()['package'] != BUNDLE:
                raise RuntimeError('Android OAuth callback did not retain the foreground app process')
        report = {'platform': 'android', 'version': version,
                  'commit': receipt['commit'], 'validator_commit': validator, 'diagnostic': diagnostic,
                  'apk_sha256': digest, 'automation': 'uiautomator2',
                  'emulator_incidents': incidents,
                  'checks': {'install_launch_restart': True, 'system_bar_themes': True, 'deep_link_dispatch': True},
                  'oauth_callbacks': CALLBACKS, 'physical_device': False,
                  'authenticated_workflows': False, 'app_alive_seconds_per_launch': 12,
                  'upgrade_exercised': False}
        (output / 'android-emulator-smoke.json').write_text(json.dumps(report, indent=2) + '\n')
    finally:
        (output / 'native-startup.log').write_text(run('adb', 'logcat', '-d'))
        subprocess.run(['adb', 'shell', 'am', 'force-stop', BUNDLE], check=False)


def ios(output):
    candidates = []
    for root in (Path('src-tauri/gen/apple'), Path('src-tauri/target')):
        for app in root.rglob('*.app'):
            info_file = app / 'Info.plist'
            if not info_file.is_file(): continue
            info = plistlib.loads(info_file.read_bytes())
            if info.get('CFBundleIdentifier') == BUNDLE and 'iPhoneSimulator' in info.get('CFBundleSupportedPlatforms', []):
                candidates.append(app)
    if not candidates: raise ValueError('No built iOS Simulator app was found')
    app = sorted(candidates, key=lambda path: ('.xcarchive/' in str(path), str(path)))[-1]
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if SCHEME not in [scheme for item in info.get('CFBundleURLTypes', []) for scheme in item.get('CFBundleURLSchemes', [])]:
        raise RuntimeError('iPhone Simulator app is missing the native OAuth scheme')
    doc = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))
    devices = [device for devices in doc['devices'].values() for device in devices if device.get('isAvailable') and device['name'].startswith('iPhone')]
    if not devices: raise RuntimeError('No available iPhone simulator runtime')
    device = devices[0]; identifier = device['udid']; booted_here = device['state'] != 'Booted'
    collector = None
    system_log = None
    try:
        if booted_here: subprocess.run(['xcrun', 'simctl', 'boot', identifier], check=True)
        subprocess.run(['xcrun', 'simctl', 'bootstatus', identifier, '-b'], check=True)
        subprocess.run(['xcrun', 'simctl', 'install', identifier, str(app)], check=True)
        # Tauri redirects iOS stdout/stderr into its Swift OS logger. The
        # simulator build must enable debug logging; production IPA signing
        # and metadata are verified independently before this step.
        native_log = output / 'native-startup.log'
        system_log = native_log.open('w')
        predicate = f'subsystem == "{BUNDLE}" AND (eventMessage CONTAINS "{CALLBACK_DELIVERED}" OR eventMessage CONTAINS "CrispDeck v")'
        collector = subprocess.Popen(['xcrun', 'simctl', 'spawn', identifier, 'log', 'stream',
                                      '--style', 'ndjson', '--level', 'debug', '--predicate', predicate],
                                     stdout=system_log, stderr=subprocess.STDOUT)
        time.sleep(1)
        if collector.poll() is not None:
            raise RuntimeError('Simulator system-log collector exited before app launch')
        stdout = output / 'native-stdout.log'
        stderr = output / 'native-stderr.log'
        env = dict(os.environ, SIMCTL_CHILD_RUST_LOG='info')
        result = subprocess.check_output(['xcrun', 'simctl', 'launch', '--terminate-running-process',
                                         f'--stdout={stdout}', f'--stderr={stderr}', identifier, BUNDLE],
                                        text=True, env=env)
        pid = int(re.search(r':\s*(\d+)\s*$', result).group(1))
        for _ in range(12): time.sleep(1); os.kill(pid, 0)
        for _ in range(20):
            if 'CrispDeck v' in ios_log_messages(native_log.read_text()): break
            time.sleep(0.5)
        if 'CrispDeck v' not in ios_log_messages(native_log.read_text()):
            raise RuntimeError('Simulator system log has no app startup receipt; callback logging is unavailable')
        subprocess.run(['xcrun', 'simctl', 'io', identifier, 'screenshot', str(output / 'native-startup.png')], check=True)
        ios_callback_tests(identifier, output)
        os.kill(pid, 0)
        for _ in range(20):
            if ios_log_messages(native_log.read_text()).count(CALLBACK_DELIVERED) >= len(CALLBACKS): break
            time.sleep(0.5)
        require_callback_delivery(ios_log_messages(native_log.read_text()), len(CALLBACKS))
        subprocess.run(['xcrun', 'simctl', 'io', identifier, 'screenshot', str(output / 'oauth-callbacks.png')], check=True)
        report = {'platform': 'ios', 'version': json.loads(Path('package.json').read_text())['version'],
                  'commit': run('git', 'rev-parse', 'HEAD').strip(), 'simulator': device['name'],
                  'app_alive_seconds': 12, 'physical_device': False, 'authenticated_workflows': False,
                  'callback_automation': 'XCUISystem.open, explicit Open confirmation and native plugin receipt',
                  'simulator_build': 'debug', 'device_ipa_build': 'release',
                  'oauth_callbacks': CALLBACKS,
                  'checks': {'simulator_smoke': True, 'deep_link_dispatch': True}}
        (output / 'checks.json').write_text(json.dumps({'checks': report['checks'], 'metadata': report}, indent=2) + '\n')
    finally:
        if collector is not None:
            collector.terminate()
            try: collector.wait(timeout=10)
            except subprocess.TimeoutExpired: collector.kill(); collector.wait(timeout=10)
        if system_log is not None: system_log.close()
        subprocess.run(['xcrun', 'simctl', 'terminate', identifier, BUNDLE], check=False)
        if booted_here: subprocess.run(['xcrun', 'simctl', 'shutdown', identifier], check=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=('android', 'ios'))
    parser.add_argument('--packages', type=Path, default=Path('release-assets'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--diagnostic', action='store_true', help='Label a retained-package check; never release evidence')
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    if args.diagnostic and args.platform != 'android': parser.error('Diagnostic mode is Android-only')
    if args.platform == 'android': android(args.packages, args.output, args.diagnostic)
    else: ios(args.output)
