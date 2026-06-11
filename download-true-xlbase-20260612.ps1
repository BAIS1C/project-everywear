$ErrorActionPreference = 'Continue'
$log = 'C:\Users\MAG MSI\Project Everywear\download-true-xlbase-20260612.log'
$url = 'https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/main/acestep-v15-xl-base-Q8_0.gguf'
$dst = 'C:\Users\MAG MSI\.everywear\models\acestep-v15-xl-base-Q8_0.gguf.NEW'
$expected = '45D05B88CCBFA0EA27208EA618D7F0749B2BE040B457CFA661D37646EA39F207'
"=== true xl-base download start $(Get-Date -Format o) ===" | Out-File $log
curl.exe -L --retry 3 --retry-delay 5 -o $dst $url 2>> $log
"curl exit: $LASTEXITCODE" | Out-File $log -Append
if (Test-Path $dst) {
  $size = (Get-Item $dst).Length
  "size: $size (expected 5305828704)" | Out-File $log -Append
  $hash = (Get-FileHash $dst -Algorithm SHA256).Hash
  "sha256: $hash" | Out-File $log -Append
  if ($hash -eq $expected) {
    "HASH VERIFIED TRUE XL-BASE. File staged as .NEW; swap awaits Sean approval." | Out-File $log -Append
  } else {
    "HASH MISMATCH — do not swap. Leave .NEW for inspection." | Out-File $log -Append
  }
}
"=== done $(Get-Date -Format o) ===" | Out-File $log -Append
