$ErrorActionPreference = 'Continue'
$env:CUDA_PATH = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8'
Set-Location 'C:\Users\MAG MSI\Project Everywear'
$log = 'C:\Users\MAG MSI\Project Everywear\rebuild-fixrun2-20260612.log'
"=== fixrun2 start $(Get-Date -Format o) HEAD: $(git rev-parse --short HEAD) ===" | Out-File $log

npm run build --workspace @everywear/gener8-web *>> $log
"=== gener8-web npm exit: $LASTEXITCODE ===" | Out-File $log -Append

cargo build --release -p everywear-os *>> $log
"=== cargo exit: $LASTEXITCODE ===" | Out-File $log -Append

Get-Item target\release\everywear-os.exe | Select-Object Name, LastWriteTime | Out-String | Out-File $log -Append
"sidecar entry present: $(Test-Path 'target\release\resources\sidecar\video-encoder\dist\index.js')" | Out-File $log -Append
"node present: $(Test-Path 'target\release\resources\node.exe')" | Out-File $log -Append
"=== fixrun2 done $(Get-Date -Format o) ===" | Out-File $log -Append
