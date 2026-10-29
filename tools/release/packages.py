#!/usr/bin/env python3
"""Collect desktop packages or verify final Android outputs without signing secrets."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile


def run(command):
    if command[0] == 'jarsigner' and shutil.which('jarsigner') is None:
        command = ['java', '-Xmx256m', '-m', 'jdk.jartool/sun.security.tools.jarsigner.Main', *command[1:]]
    return subprocess.check_output([str(arg) for arg in command], text=True)


def collect(platform, root):
    version = json.loads(Path('package.json').read_text())['version']
    root.mkdir(parents=True, exist_ok=True)
    suffixes = ['msi', 'nsis'] if platform == 'windows' else ['deb']
    for kind in suffixes:
        extension = 'exe' if kind == 'nsis' else kind
        files = list(Path('src-tauri/target/release/bundle', kind).glob('*.' + extension))
        if len(files) != 1:
            raise ValueError(f'Expected one final {kind} package, found {files}')
        if not files[0].name.startswith(f'CrispDeck_{version}_'):
            raise ValueError(f'Package filename has a stale version: {files[0].name}')
        shutil.copy2(files[0], root / files[0].name)


def android(root, sdk, expected, version=None):
    version = version or json.loads(Path('package.json').read_text())['version']
    apk = root / f'CrispDeck_{version}_android_release.apk'
    aab = root / f'CrispDeck_{version}_android_release.aab'
    toolsets = sorted((sdk / 'build-tools').iterdir(), key=lambda path: tuple(int(part) for part in re.findall(r'\d+', path.name)))
    tools = toolsets[-1]
    output = run([tools / 'apksigner', 'verify', '--verbose', '--print-certs', apk])
    fingerprints = set(re.findall(r'^(?:Signer #\d+|V[\d.]+ Signer:?) certificate SHA-256 digest: ([0-9a-f]+)$', output, re.M))
    if fingerprints != {expected}:
        raise ValueError('APK certificate differs from the retained identity')
    run([tools / 'zipalign', '-c', '-P', '16', '4', apk])
    if 'jar verified' not in run(['jarsigner', '-verify', aab]):
        raise ValueError('Final AAB is not JAR signed')
    cert = subprocess.check_output(['keytool', '-printcert', '-jarfile', str(aab), '-rfc'])
    digest = subprocess.check_output(['openssl', 'x509', '-noout', '-fingerprint', '-sha256'], input=cert).decode().strip().split('=', 1)[1].replace(':', '').lower()
    if digest != expected:
        raise ValueError('AAB certificate differs from the retained identity')
    badging = run([tools / 'aapt', 'dump', 'badging', apk]).splitlines()[0]
    if "name='com.christianstrobele.crispdeck'" not in badging or f"versionName='{version}'" not in badging:
        raise ValueError('APK identity or marketing version differs')
    manifest = run([tools / 'aapt', 'dump', 'xmltree', apk, 'AndroidManifest.xml'])
    if not re.search(r'android:scheme(?:\([^)]*\))?="app\.vercel\.crispdeck"', manifest):
        raise ValueError('Final APK is missing the native OAuth callback scheme')
    version_code = int(re.search(r"versionCode='(\d+)'", badging).group(1))
    with zipfile.ZipFile(apk) as apk_zip, zipfile.ZipFile(aab) as aab_zip, tempfile.TemporaryDirectory() as temp:
        for archive in (apk_zip, aab_zip):
            if archive.testzip(): raise ValueError('Android archive is corrupt')
        for abi in ('arm64-v8a', 'x86_64'):
            libraries = [name for name in apk_zip.namelist() if name.startswith(f'lib/{abi}/') and name.endswith('.so')]
            if not libraries: raise ValueError(f'Missing {abi} native libraries')
            for name in libraries:
                data = apk_zip.read(name)
                path = Path(temp) / Path(name).name; path.write_bytes(data)
                headers = run(['readelf', '-lW', path])
                aligns = [int(line.split()[-1], 16) for line in headers.splitlines() if line.strip().startswith('LOAD ')]
                if not aligns or min(aligns) < 0x4000:
                    raise ValueError(f'{name}: not compatible with 16 KiB pages')
                if aab_zip.read('base/' + name) != data:
                    raise ValueError('APK and AAB native libraries differ')
    (root / f'CrispDeck_{version}_android-cert.sha256').write_text(expected + '\n')
    print(f'Android {version} ({version_code}): APK/AAB signatures, identity, ZIP integrity and 16 KiB alignment verified')
    return version_code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform', choices=('windows', 'linux', 'android'))
    parser.add_argument('directory', type=Path)
    parser.add_argument('--sdk', type=Path)
    parser.add_argument('--certificate')
    parser.add_argument('--version')
    args = parser.parse_args()
    if args.platform == 'android': android(args.directory, args.sdk, args.certificate, args.version)
    else: collect(args.platform, args.directory)
