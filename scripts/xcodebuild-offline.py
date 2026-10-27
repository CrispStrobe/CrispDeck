#!/usr/bin/env python3
"""Keep Tauri's internal xcodebuild calls from changing Apple provisioning."""
import os
import sys
import json
from pathlib import Path


def local_arguments(arguments):
    return [argument for argument in arguments if argument not in {
        '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration',
    }]


def guard_log_path(script, environment=None):
    environment = os.environ if environment is None else environment
    configured = environment.get('CRISPDECK_XCODE_GUARD_LOG')
    if not configured:
        # cargo-mobile2 intentionally passes a minimal child environment.
        configured = Path(script).resolve().with_name('xcodebuild.log-path').read_text().strip()
    if not configured:
        raise ValueError('The xcodebuild provisioning guard requires an audit log')
    return Path(configured)


if __name__ == '__main__':
    with guard_log_path(__file__).open('a') as file:
        file.write(json.dumps({'archive': 'archive' in sys.argv[1:],
            'unsigned': 'CODE_SIGNING_ALLOWED=NO' in sys.argv[1:],
            'provisioning_flags_removed': len(sys.argv[1:]) - len(local_arguments(sys.argv[1:]))}) + '\n')
    os.execv('/usr/bin/xcodebuild', ['xcodebuild', *local_arguments(sys.argv[1:])])
