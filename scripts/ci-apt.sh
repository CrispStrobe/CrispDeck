#!/usr/bin/env bash
set -euo pipefail

# The hosted image's Azure HTTP mirror repeatedly delivered WebKit packages at
# tens of KB/s. Use Ubuntu's canonical HTTPS archive on disposable CI runners.
# This script must never rewrite a developer machine's package sources.
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'GitHub Actions runner required' >&2; exit 1; }
for source in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
  if [[ -f "$source" ]]; then
    sudo sed -i \
      -e 's|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
      -e 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' \
      "$source"
  fi
done
echo 'Acquire::Retries "3"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";' \
  | sudo tee /etc/apt/apt.conf.d/80-crispdeck-ci >/dev/null
