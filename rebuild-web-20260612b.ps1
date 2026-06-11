$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\MAG MSI\Project Everywear'
$log = 'C:\Users\MAG MSI\Project Everywear\rebuild-web-20260612b.log'
"=== gener8-web rebuild start $(Get-Date -Format o) HEAD: $(git rev-parse --short HEAD) ===" | Out-File $log
npm run build --workspace @everywear/gener8-web *>> $log
"=== npm exit: $LASTEXITCODE ===" | Out-File $log -Append
"=== done $(Get-Date -Format o) ===" | Out-File $log -Append
