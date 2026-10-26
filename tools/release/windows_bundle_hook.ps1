param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
$target = (Resolve-Path $File).Path
$source = Join-Path $env:GITHUB_WORKSPACE 'src-tauri/target/release/crispdeck.exe'
$isApp = $target -eq (Resolve-Path $source).Path
$mode = [string]$env:WINDOWS_SIGNING_MODE
$format = $null
if ($isApp) {
    $offset = [int]$env:CRISPDECK_BUNDLE_TYPE_OFFSET
    $template = '__TAURI_BUNDLE_TYPE_VAR_UNK'
    $marker = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($target), $offset, $template.Length)
    $format = switch ($marker) {
        '__TAURI_BUNDLE_TYPE_VAR_MSI' { 'msi' }
        '__TAURI_BUNDLE_TYPE_VAR_NSS' { 'nsis' }
        default { throw "Unexpected Tauri bundle marker: $marker" }
    }
}

switch ($mode) {
    'pfx' { & (Join-Path $PSScriptRoot 'sign_windows.ps1') -File $target }
    'azure' {
        Import-Module ArtifactSigning -RequiredVersion 0.1.8
        # azure/login obtains OIDC credentials. Use its Azure CLI session,
        # avoiding stored client secrets and interactive credential fallbacks.
        Invoke-ArtifactSigning -Endpoint $env:AZURE_SIGNING_ENDPOINT `
            -SigningAccountName $env:AZURE_SIGNING_ACCOUNT `
            -CertificateProfileName $env:AZURE_CERTIFICATE_PROFILE -Files $target `
            -FileDigest SHA256 -TimestampRfc3161 'http://timestamp.acs.microsoft.com' -TimestampDigest SHA256 `
            -ExcludeEnvironmentCredential $true -ExcludeWorkloadIdentityCredential $true `
            -ExcludeManagedIdentityCredential $true -ExcludeSharedTokenCacheCredential $true `
            -ExcludeVisualStudioCredential $true -ExcludeVisualStudioCodeCredential $true `
            -ExcludeAzureCliCredential $false -ExcludeAzurePowerShellCredential $true `
            -ExcludeAzureDeveloperCliCredential $true -ExcludeInteractiveBrowserCredential $true
    }
    '' { } # Build-only: observe patched bytes without claiming publisher signing.
    default { throw 'Unknown Windows signing mode.' }
}
$signature = Get-AuthenticodeSignature $target
$signed = $signature.Status -eq 'Valid'
$timestamped = $null -ne $signature.TimeStamperCertificate
if ($mode -in 'pfx', 'azure' -and (-not $signed -or -not $timestamped)) {
    throw "Bundle signing did not produce a valid timestamped signature: $target"
}
if ($isApp) {
    $output = Join-Path $env:RUNNER_TEMP 'windows-smoke'
    New-Item -ItemType Directory -Force $output | Out-Null
    $commit = (git -C $env:GITHUB_WORKSPACE rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the packaged source commit.' }
    @{
        format = $format; commit = $commit; sha256 = (Get-FileHash $target).Hash
        bytes = (Get-Item $target).Length; authenticode = $signed; timestamp = $timestamped
        publisher_thumbprint = $signature.SignerCertificate.Thumbprint
    } | ConvertTo-Json | Set-Content (Join-Path $output "bundled-$format-native.json")
}
