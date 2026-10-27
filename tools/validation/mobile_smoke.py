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


def android_toggle_theme(output):
    subprocess.run(['adb', 'shell', 'uiautomator', 'dump', '--compressed', '/sdcard/crispdeck-ui.xml'], check=True)
    xml = run('adb', 'shell', 'cat', '/sdcard/crispdeck-ui.xml')
    (output / 'theme-controls.xml').write_text(xml)
    controls = [node for node in ET.fromstring(xml).iter('node')
                if node.get('content-desc') == 'Toggle theme' or node.get('text') == 'Toggle theme']
    if len(controls) != 1:
        raise RuntimeError(f'Expected one accessible theme toggle, found {len(controls)}')
    bounds = list(map(int, re.findall(r'\d+', controls[0].get('bounds', ''))))
    if len(bounds) != 4 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        raise RuntimeError('Android theme toggle has no tappable bounds')
    subprocess.run(['adb', 'shell', 'input', 'tap', str((bounds[0] + bounds[2]) // 2),
                    str((bounds[1] + bounds[3]) // 2)], check=True)
    time.sleep(2)


def android(root, output):
    version = json.loads(Path('package.json').read_text())['version']
    apk = root / f'CrispDeck_{version}_android_release.apk'
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
        android_toggle_theme(output)
        android_theme_check(output, 'oled', False)
        android_toggle_theme(output)
        android_theme_check(output, 'light', True)
        subprocess.run(['adb', 'shell', 'am', 'force-stop', BUNDLE], check=True)
        launch()
        android_theme_check(output, 'light-restarted', True)
        android_toggle_theme(output)
        android_theme_check(output, 'dark-restored', False)
        with apk.open('rb') as file: digest = hashlib.file_digest(file, 'sha256').hexdigest()
        report = {'platform': 'android', 'version': version,
                  'commit': run('git', 'rev-parse', 'HEAD').strip(), 'apk_sha256': digest,
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
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    if args.platform == 'android': android(args.packages, args.output)
    else: ios(args.output)
