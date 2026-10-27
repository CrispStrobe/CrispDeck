#!/usr/bin/env python3
"""Keep Tauri's internal xcodebuild calls from changing Apple provisioning."""
import os
import sys
import json


def local_arguments(arguments):
    return [argument for argument in arguments if argument not in {
        '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration',
    }]


if __name__ == '__main__':
    log = os.environ.get('CRISPDECK_XCODE_GUARD_LOG')
    if log:
        with open(log, 'a') as file:
            file.write(json.dumps({'archive': 'archive' in sys.argv[1:],
                'unsigned': 'CODE_SIGNING_ALLOWED=NO' in sys.argv[1:],
                'provisioning_flags_removed': len(sys.argv[1:]) - len(local_arguments(sys.argv[1:]))}) + '\n')
    os.execv('/usr/bin/xcodebuild', ['xcodebuild', *local_arguments(sys.argv[1:])])
