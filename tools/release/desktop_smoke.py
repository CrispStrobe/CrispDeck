#!/usr/bin/env python3
"""Install/replace a native desktop app and check startup on an ephemeral CI host."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import platform as host_platform


def clean_environment():
    return {key: value for key, value in os.environ.items()
            if not re.search(r'TOKEN|PASSWORD|SECRET|KEYSTORE|PFX|ASC_API|APPLE_API|CERTIFICATE', key, re.I)}


def previous_package(version, suffix, destination):
    """Use only published official releases older than this package."""
    releases = json.loads(subprocess.check_output(['gh', 'release', 'list', '--exclude-drafts',
                          '--exclude-pre-releases', '--limit', '100', '--json', 'tagName'], text=True))
    current = tuple(map(int, version.split('.')))
    tags = [item['tagName'] for item in releases if re.fullmatch(r'v\d+\.\d+\.\d+', item['tagName'])
            and tuple(map(int, item['tagName'][1:].split('.'))) < current]
    for tag in sorted(tags, key=lambda value: tuple(map(int, value[1:].split('.'))), reverse=True):
        release = json.loads(subprocess.check_output(['gh', 'release', 'view', tag, '--json', 'assets'], text=True))
        matches = [asset['name'] for asset in release['assets'] if asset['name'].endswith(suffix)]
        if len(matches) == 1:
            subprocess.run(['gh', 'release', 'download', tag, '--pattern', matches[0], '--dir', str(destination)], check=True)
            return destination / matches[0]
    return None


def launch(executable, report, directory, linux=False):
    env = clean_environment()
    if linux:
        # The hosted headless runner lacks a working accelerated DMABUF surface.
        env.update(GDK_BACKEND='x11', WEBKIT_DISABLE_DMABUF_RENDERER='1', LIBGL_ALWAYS_SOFTWARE='1')
    with (directory / 'native-startup.log').open('w') as log:
        process = subprocess.Popen([str(executable)], env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(12):
                time.sleep(1)
                if process.poll() is not None:
                    raise RuntimeError(f'Installed app exited during startup ({process.returncode}); inspect native-startup.log')
            report['app_alive_seconds'] = 12
            if linux:
                windows = subprocess.check_output(['xdotool', 'search', '--onlyvisible', '--pid', str(process.pid)], text=True).split()
                if not windows: raise RuntimeError('Native app did not create a visible X11 window')
                report['visible_window'] = True
                subprocess.run(['import', '-window', windows[0], str(directory / 'native-startup.png')], check=True)
            else:
                subprocess.run(['screencapture', '-x', str(directory / 'native-startup.png')], check=False)
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=10)


def linux(package, version, directory):
    report = {'platform': 'linux', 'version': version, 'physical_device': False, 'authenticated_workflows': False}
    profile = Path.home() / '.local/share/com.christianstrobele.crispdeck'
    profile.mkdir(parents=True, exist_ok=True)
    marker = profile / 'installer-smoke.marker'
    marker.write_text('Preserve application data across installer upgrades.\n')
    with tempfile.TemporaryDirectory() as temp:
        previous = previous_package(version, '_amd64.deb', Path(temp))
        if previous:
            subprocess.run(['sudo', 'apt-get', 'install', '-y', '--allow-downgrades', str(previous)], check=True)
            report['previous_version'] = subprocess.check_output(['dpkg-deb', '-f', str(previous), 'Version'], text=True).strip()
        subprocess.run(['sudo', 'apt-get', 'install', '-y', '--allow-downgrades', str(package.resolve())], check=True)
    installed = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'crispdeck'], text=True).strip()
    if installed != version: raise RuntimeError(f'Installed Linux version is {installed}, expected {version}')
    if not marker.is_file(): raise RuntimeError('Installer removed existing application data')
    report['profile_marker_preserved'] = True
    report['upgrade_exercised'] = previous is not None
    executable = shutil.which('crispdeck')
    if not executable: raise RuntimeError('Installed desktop executable is missing')
    launch(Path(executable), report, directory, linux=True)
    return report


def mount_copy(dmg, destination):
    with tempfile.TemporaryDirectory() as mount:
        subprocess.run(['hdiutil', 'attach', str(dmg), '-nobrowse', '-readonly', '-mountpoint', mount], check=True)
        try:
            apps = list(Path(mount).glob('*.app'))
            if len(apps) != 1: raise RuntimeError('Expected one app in the DMG')
            if destination.exists(): shutil.rmtree(destination)
            subprocess.run(['ditto', str(apps[0]), str(destination)], check=True)
        finally:
            subprocess.run(['hdiutil', 'detach', mount], check=True)


def macos(package, version, directory):
    report = {'platform': 'macos', 'version': version, 'physical_device': False, 'authenticated_workflows': False}
    app = directory / 'Applications/CrispDeck.app'
    app.parent.mkdir(parents=True, exist_ok=True)
    profile = Path.home() / 'Library/Application Support/com.christianstrobele.crispdeck'
    profile.mkdir(parents=True, exist_ok=True)
    marker = profile / 'installer-smoke.marker'; marker.write_text('Preserve application data.\n')
    with tempfile.TemporaryDirectory() as temp:
        previous = previous_package(version, '_universal.dmg', Path(temp))
        if previous is None:
            suffix = '_aarch64.dmg' if host_platform.machine() == 'arm64' else '_x64.dmg'
            previous = previous_package(version, suffix, Path(temp))
        if previous:
            mount_copy(previous, app)
            report['previous_version'] = subprocess.check_output(['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleShortVersionString', str(app / 'Contents/Info.plist')], text=True).strip()
        mount_copy(package.resolve(), app)
    installed = subprocess.check_output(['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleShortVersionString', str(app / 'Contents/Info.plist')], text=True).strip()
    if installed != version: raise RuntimeError('Installed Mac marketing version differs')
    if not marker.is_file(): raise RuntimeError('App replacement removed application data')
    report.update(profile_marker_preserved=True, upgrade_exercised=previous is not None)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    subprocess.run(['spctl', '--assess', '--type', 'execute', str(app)], check=True)
    launch(app / 'Contents/MacOS/CrispDeck', report, directory)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=('linux', 'macos'))
    parser.add_argument('package', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    version = json.loads(Path('package.json').read_text())['version']
    result = (linux if args.platform == 'linux' else macos)(args.package, version, args.output)
    (args.output / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    (args.output / 'checks.json').write_text(json.dumps({'checks': {'install_smoke': True}, 'metadata': result}, indent=2) + '\n')
    print(json.dumps(result))
