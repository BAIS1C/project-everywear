$ErrorActionPreference = 'Continue'
$env:CUDA_PATH = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8'
Set-Location 'C:\Users\MAG MSI\Project Everywear'
$log = 'C:\Users\MAG MSI\Project Everywear\rebuild-shell-20260612c.log'
"=== shell rebuild start $(Get-Date -Format o) HEAD: $(git rev-parse --short HEAD) ===" | Out-File $log
npm run build --workspace everywear-os *>> $log
"=== shell npm exit: $LASTEXITCODE ===" | Out-File $log -Append
cargo build --release -p everywear-os *>> $log
"=== cargo exit: $LASTEXITCODE ===" | Out-File $log -Append
Get-Item target\release\everywear-os.exe | Select-Object Name, LastWriteTime | Out-String | Out-File $log -Append
"=== done $(Get-Date -Format o) ===" | Out-File $log -Append
