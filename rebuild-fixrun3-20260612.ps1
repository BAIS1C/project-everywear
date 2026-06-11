$ErrorActionPreference = 'Continue'
$env:CUDA_PATH = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8'
Set-Location 'C:\Users\MAG MSI\Project Everywear'
$log = 'C:\Users\MAG MSI\Project Everywear\rebuild-fixrun3-20260612.log'
"=== fixrun3 start $(Get-Date -Format o) HEAD: $(git rev-parse --short HEAD) ===" | Out-File $log

npm run build --workspace @everywear/gener8-web *>> $log
"=== gener8-web npm exit: $LASTEXITCODE ===" | Out-File $log -Append

cargo build --release -p gener8 *>> $log
"=== cargo gener8 exit: $LASTEXITCODE ===" | Out-File $log -Append

Get-Item target\release\gener8.exe | Select-Object Name, LastWriteTime | Out-String | Out-File $log -Append
"=== fixrun3 done $(Get-Date -Format o) ===" | Out-File $log -Append
