#!/usr/bin/env python3
"""Native emulator/simulator startup checks; never claim physical-device or account validation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

BUNDLE = 'com.christianstrobele.crispdeck'


def run(*args):
    return subprocess.check_output([str(arg) for arg in args], text=True)


def android_bar_appearance(dump):
    windows = re.split(r'(?m)^\s*Window #\d+ ', dump)
    window = next((block for block in windows if block.strip() and BUNDLE + '/' in block.splitlines()[0]
                   and 'mAttrs=' in block), None)
    if window is None:
        raise RuntimeError('No CrispDeck window attributes in the Android system-bar dump')
    return {name: bool(re.search(r'\b' + flag + r'\b', window)) for name, flag in
            [('status', 'LIGHT_STATUS_BARS'), ('navigation', 'LIGHT_NAVIGATION_BARS')]}


def android_theme_check(output, name, light):
    dump = run('adb', 'shell', 'dumpsys', 'window', 'windows')
    (output / f'window-{name}.log').write_text(dump)
    appearance = android_bar_appearance(dump)
    if appearance != {'status': light, 'navigation': light}:
        raise RuntimeError(f'Android {name} system-bar appearance is {appearance}, expected light={light}')
    with (output / f'theme-{name}.png').open('wb') as file:
        subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True)


def android_toggle_theme(output, automation, transition):
    # Keep one UiAutomation service connected across launches. Starting a fresh
    # `uiautomator dump` process for each query can miss WebView virtual nodes.
    for attempt in range(6):
        xml = automation.dump_hierarchy(compressed=False)
        (output / f'theme-controls-{transition}-{attempt}.xml').write_text(xml)
        controls = [node for node in ET.fromstring(xml).iter('node')
                    if node.get('content-desc') == 'Toggle theme' or node.get('text') == 'Toggle theme']
        if controls:
            break
        time.sleep(1)
    if len(controls) != 1:
        raise RuntimeError(f'Expected one accessible theme toggle, found {len(controls)}')
    bounds = list(map(int, re.findall(r'\d+', controls[0].get('bounds', ''))))
    if len(bounds) != 4 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        raise RuntimeError('Android theme toggle has no tappable bounds')
    automation.click((bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)
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
        android_theme_check(output, 'dark', False)
        android_toggle_theme(output, automation, 'dark-to-oled')
        android_theme_check(output, 'oled', False)
        android_toggle_theme(output, automation, 'oled-to-light')
        android_theme_check(output, 'light', True)
        subprocess.run(['adb', 'shell', 'am', 'force-stop', BUNDLE], check=True)
        launch()
        android_theme_check(output, 'light-restarted', True)
        android_toggle_theme(output, automation, 'light-to-dark')
        android_theme_check(output, 'dark-restored', False)
        report = {'platform': 'android', 'version': version,
                  'commit': receipt['commit'], 'validator_commit': validator, 'diagnostic': diagnostic,
                  'apk_sha256': digest, 'automation': 'uiautomator2',
                  'checks': {'install_launch_restart': True, 'system_bar_themes': True}, 'physical_device': False,
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
    doc = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '-j'))
    devices = [device for devices in doc['devices'].values() for device in devices if device.get('isAvailable') and device['name'].startswith('iPhone')]
    if not devices: raise RuntimeError('No available iPhone simulator runtime')
    device = devices[0]; identifier = device['udid']; booted_here = device['state'] != 'Booted'
    try:
        if booted_here: subprocess.run(['xcrun', 'simctl', 'boot', identifier], check=True)
        subprocess.run(['xcrun', 'simctl', 'bootstatus', identifier, '-b'], check=True)
        subprocess.run(['xcrun', 'simctl', 'install', identifier, str(app)], check=True)
        result = run('xcrun', 'simctl', 'launch', '--terminate-running-process', identifier, BUNDLE)
        pid = int(re.search(r':\s*(\d+)\s*$', result).group(1))
        for _ in range(12): time.sleep(1); os.kill(pid, 0)
        subprocess.run(['xcrun', 'simctl', 'io', identifier, 'screenshot', str(output / 'native-startup.png')], check=True)
        report = {'platform': 'ios', 'version': json.loads(Path('package.json').read_text())['version'],
                  'commit': run('git', 'rev-parse', 'HEAD').strip(), 'simulator': device['name'],
                  'app_alive_seconds': 12, 'physical_device': False, 'authenticated_workflows': False,
                  'checks': {'simulator_smoke': True}}
        (output / 'checks.json').write_text(json.dumps({'checks': report['checks'], 'metadata': report}, indent=2) + '\n')
    finally:
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
