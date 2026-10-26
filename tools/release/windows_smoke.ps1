param([string]$Directory = 'release-assets', [string]$Output)
$ErrorActionPreference = 'Stop'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$root = (Resolve-Path $Directory).Path
New-Item -ItemType Directory -Force $Output | Out-Null
$msi = Join-Path $root "CrispDeck_${version}_x64_en-US.msi"
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($msi, 0)
$view = $database.OpenView("SELECT Value FROM Property WHERE Property = 'ProductVersion'")
$view.Execute(); $record = $view.Fetch()
if ($record.StringData(1) -ne $version) { throw 'MSI marketing version differs from package.json.' }
$view.Close()

function Install-Msi([string]$Path) {
    $result = Start-Process msiexec.exe -ArgumentList @('/i', "`"$Path`"", '/qn', '/norestart') -Wait -PassThru
    if ($result.ExitCode -notin 0, 3010) { throw "MSI installation failed: $($result.ExitCode)" }
}

$previous = $null
$history = gh release list --exclude-drafts --exclude-pre-releases --limit 100 --json tagName | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not read previous official releases.' }
$tags = $history | Where-Object { $_.tagName -match '^v\d+\.\d+\.\d+$' -and [version]$_.tagName.Substring(1) -lt [version]$version } |
    Sort-Object { [version]$_.tagName.Substring(1) } -Descending
foreach ($tag in $tags) {
    $release = gh release view $tag.tagName --json assets | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read official release assets.' }
    $assets = @($release.assets | Where-Object { $_.name.EndsWith('_x64_en-US.msi') })
    if ($assets.Count -eq 1) {
        gh release download $tag.tagName --pattern $assets[0].name --dir $Output
        if ($LASTEXITCODE -ne 0) { throw 'Could not download the previous MSI.' }
        Install-Msi (Join-Path $Output $assets[0].name)
        $previous = $tag.tagName.Substring(1)
        break
    }
}
$profile = Join-Path $env:APPDATA 'com.christianstrobele.crispdeck'
New-Item -ItemType Directory -Force $profile | Out-Null
$marker = Join-Path $profile 'installer-smoke.marker'
'Retain existing application data.' | Set-Content $marker
Install-Msi $msi
if (-not (Test-Path $marker)) { throw 'Installer removed existing application data.' }
$installed = Get-ChildItem (Join-Path $env:ProgramFiles 'CrispDeck') -Recurse -Filter 'crispdeck.exe' | Select-Object -First 1
if (-not $installed) { throw 'Installed CrispDeck executable is missing.' }
if (-not $installed.VersionInfo.ProductVersion.StartsWith($version + '.') -and $installed.VersionInfo.ProductVersion -ne $version) {
    throw "Installed app has unexpected version: $($installed.VersionInfo.ProductVersion)"
}
$source = 'src-tauri/target/release/crispdeck.exe'
if ((Get-FileHash $source).Hash -ne (Get-FileHash $installed.FullName).Hash) { throw 'Installer changed or substituted the native executable.' }
$files = @($installed) + @(Get-ChildItem $Directory -File | Where-Object { $_.Extension -in '.exe', '.msi' })
$signed = $true; $timestamped = $true; $identities = @()
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature $file.FullName
    $signed = $signed -and $signature.Status -eq 'Valid'
    $timestamped = $timestamped -and $null -ne $signature.TimeStamperCertificate
    if ($signature.SignerCertificate) { $identities += $signature.SignerCertificate.Thumbprint }
}
if ($env:WINDOWS_SIGNING_MODE -in 'pfx', 'azure' -and (-not $signed -or -not $timestamped)) {
    throw 'Configured production signing did not produce valid, timestamped signatures for app and installers.'
}
$info = [Diagnostics.ProcessStartInfo]::new($installed.FullName)
$info.UseShellExecute = $false
foreach ($name in @($info.Environment.Keys)) {
    if ($name -match 'TOKEN|PASSWORD|SECRET|KEYSTORE|PFX|ASC_API|APPLE_API|CERTIFICATE') { $info.Environment.Remove($name) | Out-Null }
}
$process = [Diagnostics.Process]::Start($info)
try {
    $visible = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1; $process.Refresh()
        if ($process.HasExited) { throw "Installed app exited during startup: $($process.ExitCode)" }
        if ($process.MainWindowHandle -ne 0) { $visible = $true }
    }
    if (-not $visible) { throw 'Installed app never created a native window.' }
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $bounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $image = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($image)
    $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
    $image.Save((Join-Path $Output 'native-startup.png'), [Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose(); $image.Dispose()
} finally {
    if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
}
$result = @{
    checks = @{ package_metadata = $true; install_smoke = $true; authenticode = $signed; timestamp = $timestamped }
    metadata = @{ previous_version = $previous; upgrade_exercised = $null -ne $previous; profile_marker_preserved = $true;
        visible_window = $visible; app_alive_seconds = 20; publisher_thumbprints = @($identities | Select-Object -Unique);
        physical_device = $false; authenticated_workflows = $false }
}
$result | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Output 'checks.json')
Write-Output ($result | ConvertTo-Json -Depth 5)
