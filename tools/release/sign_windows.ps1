param([string]$File, [string]$Directory)
$ErrorActionPreference = 'Stop'
if (-not $env:WINDOWS_CERT_PFX_BASE64 -or -not $env:WINDOWS_CERT_PASSWORD) {
    throw 'Production Windows certificate and password are required.'
}
$pfx = Join-Path $env:RUNNER_TEMP 'crispdeck-publisher.pfx'
$certificate = $null
try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERT_PFX_BASE64))
    $password = ConvertTo-SecureString $env:WINDOWS_CERT_PASSWORD -AsPlainText -Force
    $certificate = Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\My -Password $password |
        Where-Object { $_.HasPrivateKey -and ($_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3') } |
        Select-Object -First 1
    if (-not $certificate) { throw 'No code-signing private identity was found in the supplied PFX.' }
    if ($certificate.NotAfter -le [DateTime]::UtcNow) { throw 'Publisher certificate has expired.' }
    $signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
        Sort-Object { [version]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
    if (-not $signTool) { throw 'Windows SDK SignTool is unavailable.' }
    $files = if ($File) { @(Get-Item $File) } else { @(Get-ChildItem $Directory -File | Where-Object { $_.Extension -in '.exe', '.msi' }) }
    if ($files.Count -eq 0) { throw 'No Windows binaries were selected for signing.' }
    foreach ($item in $files) {
        & $signTool.FullName sign /sha1 $certificate.Thumbprint /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $item.FullName
        if ($LASTEXITCODE -ne 0) { throw "SignTool failed for $($item.Name)" }
        $signature = Get-AuthenticodeSignature $item.FullName
        if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
            throw "Publisher signature/timestamp verification failed for $($item.Name)"
        }
    }
} finally {
    Remove-Item $pfx -Force -ErrorAction SilentlyContinue
    if ($certificate) { Remove-Item "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force }
}
