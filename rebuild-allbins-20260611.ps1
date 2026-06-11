$ErrorActionPreference = 'Continue'
$env:CUDA_PATH = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8'
Set-Location 'C:\Users\MAG MSI\Project Everywear'
$log = 'C:\Users\MAG MSI\Project Everywear\rebuild-allbins-20260611.log'
"=== rebuild start $(Get-Date -Format o) HEAD: $(git rev-parse --short HEAD) ===" | Out-File $log

npm run build --workspace @everywear/gener8-web *>> $log
"=== gener8-web npm exit: $LASTEXITCODE ===" | Out-File $log -Append
npm run build --workspace applets/vid/web *>> $log
"=== vid-web npm exit: $LASTEXITCODE ===" | Out-File $log -Append
npm run build --workspace everywear-os *>> $log
"=== everywear-os npm exit: $LASTEXITCODE ===" | Out-File $log -Append

cargo build --release -p everywear-os -p gener8 -p onemagen -p everywear-3nvizen -p everywear-kasai *>> $log
"=== cargo exit: $LASTEXITCODE ===" | Out-File $log -Append

"=== exe mtimes after build ===" | Out-File $log -Append
Get-Item target\release\*.exe | Select-Object Name, LastWriteTime | Out-String | Out-File $log -Append
"=== encoder resources next to exe ===" | Out-File $log -Append
Test-Path 'target\release\resources\node.exe' | Out-File $log -Append
Test-Path 'target\release\resources\sidecar\video-encoder\dist\index.js' | Out-File $log -Append
"=== rebuild done $(Get-Date -Format o) ===" | Out-File $log -Append
