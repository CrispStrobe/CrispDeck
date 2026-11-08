#!/usr/bin/env python3
"""Check the actual debug APK's safe viewport on an ephemeral Android emulator."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

import mobile_smoke as smoke


FRAME = r'\[\s*(-?\d+),\s*(-?\d+)\]\[\s*(-?\d+),\s*(-?\d+)\]'
HANDLED_TYPES = {'statusBars', 'navigationBars', 'captionBar', 'displayCutout', 'ime'}


def display_insets(dump):
    """Read the default display's current sources, not stale provider/control data."""
    displays = re.split(r'(?m)^\s*Display:\s*mDisplayId=', dump)
    matches = [block for block in displays[1:] if re.match(r'0(?:\D|$)', block)]
    if len(matches) != 1:
        raise RuntimeError('Expected one Android default display')
    state = re.search(r'(?ms)^\s*WindowInsetsStateController\s*\n(.*?)^\s*Control map:', matches[0])
    if state is None:
        raise RuntimeError('Android did not expose the raw window inset state')
    display = re.search(r'mDisplayFrame=Rect\(\s*(-?\d+),\s*(-?\d+)\s+-\s+(-?\d+),\s*(-?\d+)\)', state[1])
    if display is None:
        raise RuntimeError('Android did not expose its display bounds')
    bounds = tuple(map(int, display.groups()))
    sources = []
    for line in state[1].splitlines():
        if 'InsetsSource' not in line:
            continue
        kind = re.search(r'\b(?:type|mType)=(\w+)', line)
        frame = re.search(r'\b(?:frame|mFrame)=' + FRAME, line)
        visible = re.search(r'\b(?:visible|mVisible)=(true|false)', line)
        if kind and kind[1] in HANDLED_TYPES:
            if frame is None or visible is None:
                raise RuntimeError('Android reported an unreadable inset source')
            sources.append({'type': kind[1], 'bounds': tuple(map(int, frame.groups())),
                            'visible': visible[1] == 'true'})
    if not any(source['type'] == 'statusBars' for source in sources):
        raise RuntimeError('Missing Android system-bar inset evidence')
    return bounds, sources


def viewport_geometry(xml, dump):
    """Compare native accessibility bounds with independently reported OS insets."""
    display, sources = display_insets(dump)
    webviews = set()
    for node in ET.fromstring(xml).iter('node'):
        if node.get('package') == smoke.BUNDLE and node.get('class', '').endswith('WebView'):
            match = re.fullmatch(FRAME, node.get('bounds', ''))
            if match:
                webviews.add(tuple(map(int, match.groups())))
    if len(webviews) != 1:
        raise RuntimeError(f'Expected one native CrispDeck WebView, found {len(webviews)}')
    actual = next(iter(webviews))
    expected = list(display)
    for source in sources:
        if not source['visible']:
            continue
        left, top, right, bottom = source['bounds']
        if right <= left or bottom <= top:
            continue
        # InsetsSource frames span the corresponding display edge. Intersect
        # each against the original display so overlapping IME/nav sources do
        # not accumulate padding.
        if left <= display[0] and right >= display[2]:
            if top <= display[1]:
                expected[1] = max(expected[1], bottom)
            if bottom >= display[3]:
                expected[3] = min(expected[3], top)
        if top <= display[1] and bottom >= display[3]:
            if left <= display[0]:
                expected[0] = max(expected[0], right)
            if right >= display[2]:
                expected[2] = min(expected[2], left)
        if (actual[0] < right and actual[2] > left and
                actual[1] < bottom and actual[3] > top):
            raise RuntimeError(f'WebView {actual} overlaps Android {source["type"]} {source["bounds"]}')
    if expected[2] <= expected[0] or expected[3] <= expected[1]:
        raise RuntimeError('Android reported no usable viewport')
    if any(abs(found - wanted) > 1 for found, wanted in zip(actual, expected)):
        raise RuntimeError(f'WebView {actual} does not fill safe viewport {tuple(expected)}; possible double padding')
    return {'display': display, 'webview': actual, 'safe_viewport': expected,
            'ime_visible': any(source['type'] == 'ime' and source['visible'] and
                               source['bounds'][3] > source['bounds'][1] for source in sources),
            'insets': sources}


def screenshot(output, name):
    with (output / f'{name}.png').open('wb') as file:
        subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True)


def capture_stage(output, automation, name, incidents, *, ime=False, landscape=False):
    last_error = None
    for attempt in range(16):
        xml = smoke.android_hierarchy(output, automation, f'{name}-{attempt}', incidents)
        dump = smoke.run('adb', 'shell', 'dumpsys', 'window', 'displays')
        (output / f'display-{name}-{attempt}.log').write_text(dump)
        try:
            if automation.app_current()['package'] != smoke.BUNDLE:
                raise RuntimeError('CrispDeck is not the foreground app')
            geometry = viewport_geometry(xml, dump)
            if geometry['ime_visible'] != ime:
                raise RuntimeError(f'Keyboard visibility is not {ime}')
            display = geometry['display']
            if (display[2] - display[0] > display[3] - display[1]) != landscape:
                raise RuntimeError('Android has not reached the requested orientation')
            screenshot(output, name)
            return geometry
        except RuntimeError as error:
            last_error = error
            time.sleep(0.5)
    screenshot(output, f'{name}-failed')
    raise RuntimeError(f'{name}: {last_error}')


def tap_control(output, automation, name, incidents, *, label=None, editable=False):
    for attempt in range(12):
        xml = smoke.android_hierarchy(output, automation, f'{name}-{attempt}', incidents)
        nodes = [node for node in ET.fromstring(xml).iter('node')
                 if node.get('package') == smoke.BUNDLE and node.get('enabled') == 'true'
                 and ((editable and node.get('class') == 'android.widget.EditText') or
                      (label is not None and label in (node.get('text'), node.get('content-desc'))))]
        if nodes:
            automation.click(*smoke.android_node_center(nodes[0]))
            return
        time.sleep(0.5)
    raise RuntimeError(f'No accessible Android control for {name}')


def run_layout_checks(apk, output):
    import uiautomator2
    # This runner changes system navigation/rotation and resets only its own
    # debug install. It must never run against a connected physical phone.
    if smoke.run('adb', 'shell', 'getprop', 'ro.kernel.qemu').strip() != '1':
        raise RuntimeError('Android layout validation requires an ephemeral emulator')
    output.mkdir(parents=True, exist_ok=True)
    automation = uiautomator2.connect()
    incidents = []
    smoke.android_hierarchy(output, automation, 'before-install', incidents)
    subprocess.run(['adb', 'install', '-r', str(apk)], check=True)
    package = smoke.run('adb', 'shell', 'dumpsys', 'package', smoke.BUNDLE)
    if 'DEBUGGABLE' not in package:
        raise RuntimeError('Layout validation requires a debug APK')
    subprocess.run(['adb', 'shell', 'pm', 'clear', smoke.BUNDLE], check=True)
    component = smoke.run('adb', 'shell', 'cmd', 'package', 'resolve-activity', '--brief', smoke.BUNDLE).strip().splitlines()[-1]
    if not component.startswith(smoke.BUNDLE + '/'):
        raise RuntimeError('The debug APK has no CrispDeck launch activity')
    subprocess.run(['adb', 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'], check=True)
    subprocess.run(['adb', 'shell', 'settings', 'put', 'system', 'user_rotation', '0'], check=True)
    subprocess.run(['adb', 'shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1'], check=True)
    overlays = smoke.run('adb', 'shell', 'cmd', 'overlay', 'list')
    stages = {}
    try:
        for mode in ['threebutton', 'gestural']:
            overlay = f'com.android.internal.systemui.navbar.{mode}'
            if overlay not in overlays:
                raise RuntimeError(f'Emulator does not support navigation mode {mode}')
            subprocess.run(['adb', 'shell', 'cmd', 'overlay', 'enable-exclusive', '--category', overlay], check=True)
            subprocess.run(['adb', 'shell', 'am', 'start', '-W', '-n', component], check=True)
            # The preceding mode ends in Compose. Start each pass from a
            # non-editable page so retained input focus cannot reopen the IME.
            tap_control(output, automation, f'{mode}-feed', incidents, label='Feed')
            stages[f'{mode}-portrait'] = capture_stage(output, automation, f'{mode}-portrait', incidents)
            for transition, theme, light in [('dark-to-oled', 'oled', False),
                                              ('oled-to-light', 'light', True),
                                              ('light-to-dark', 'dark', False)]:
                smoke.android_toggle_theme(output, automation, f'{mode}-{transition}', incidents)
                smoke.android_theme_check(output, f'{mode}-{theme}', light, automation, incidents)
                stages[f'{mode}-{theme}'] = capture_stage(output, automation, f'{mode}-{theme}', incidents)
            subprocess.run(['adb', 'shell', 'settings', 'put', 'system', 'user_rotation', '1'], check=True)
            stages[f'{mode}-landscape'] = capture_stage(output, automation, f'{mode}-landscape', incidents, landscape=True)
            subprocess.run(['adb', 'shell', 'settings', 'put', 'system', 'user_rotation', '0'], check=True)
            portrait = capture_stage(output, automation, f'{mode}-portrait-restored', incidents)
            tap_control(output, automation, f'{mode}-compose', incidents, label='Post')
            tap_control(output, automation, f'{mode}-focus-editor', incidents, editable=True)
            stages[f'{mode}-keyboard'] = capture_stage(output, automation, f'{mode}-keyboard', incidents, ime=True)
            subprocess.run(['adb', 'shell', 'input', 'keyevent', 'KEYCODE_BACK'], check=True)
            restored = capture_stage(output, automation, f'{mode}-keyboard-dismissed', incidents)
            if restored['webview'] != portrait['webview']:
                raise RuntimeError('Dismissing the keyboard left stale viewport padding')
            stages[f'{mode}-keyboard-dismissed'] = restored
        with apk.open('rb') as file:
            digest = hashlib.file_digest(file, 'sha256').hexdigest()
        (output / 'layout-result.json').write_text(json.dumps({
            'commit': smoke.run('git', 'rev-parse', 'HEAD').strip(), 'apk_sha256': digest,
            'checks': ['native_system_insets', 'three_button_navigation', 'gesture_navigation',
                       'theme_changes', 'rotation', 'keyboard_open_close'],
            'physical_device': False, 'authenticated_workflows': False,
            'emulator_incidents': incidents, 'stages': stages,
        }, indent=2) + '\n')
    finally:
        (output / 'logcat.log').write_text(smoke.run('adb', 'logcat', '-d', '-t', '2000'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    run_layout_checks(arguments.apk, arguments.output)
