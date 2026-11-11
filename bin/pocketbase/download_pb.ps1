# Script tai va giai nen PocketBase binary cho Windows x64
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetExe = Join-Path $scriptDir "pocketbase.exe"

if (Test-Path $targetExe) {
    Write-Host "[OK] pocketbase.exe da ton tai tai $targetExe"
    & $targetExe --version
    exit 0
}

Write-Host "Dang tim phien ban PocketBase moi nhat..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$apiUrl = "https://api.github.com/repos/pocketbase/pocketbase/releases/latest"
$headers = @{ "User-Agent" = "SGL-PocketBase-Downloader" }

$downloadUrl = $null
$assetName = $null

try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -TimeoutSec 15
    foreach ($item in $release.assets) {
        if ($item.name -like "*windows_amd64.zip") {
            $downloadUrl = $item.browser_download_url
            $assetName = $item.name
            break
        }
    }
}
catch {
    Write-Host "Khong the truy van GitHub API (co the do rate limit). Su dung link truc tiep..."
}

# Fallback link neu GitHub API bi limit
if (-not $downloadUrl) {
    $downloadUrl = "https://github.com/pocketbase/pocketbase/releases/download/v0.25.9/pocketbase_0.25.9_windows_amd64.zip"
    $assetName = "pocketbase_0.25.9_windows_amd64.zip"
}

$zipPath = Join-Path $scriptDir $assetName
Write-Host "Dang tai PocketBase tu: $downloadUrl ..."
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -lt 100000) {
    throw "Loi: File zip tai ve khong hop le hoac qua nho!"
}

Write-Host "Dang giai nen vao $scriptDir ..."
Expand-Archive -Path $zipPath -DestinationPath $scriptDir -Force

Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $targetExe)) {
    throw "Loi: Khong tim thay pocketbase.exe sau khi giai nen!"
}

Write-Host "[THANH CONG] Da cai dat xong PocketBase!"
& $targetExe --version
