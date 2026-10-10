# Verification only; no signing provider, keys, upload, installation, or helper execution.
[CmdletBinding()]
param(
 [ValidatePattern('^[a-z0-9-]{1,32}$')][string]$BuildName='review-a',
 [string]$ApprovedSignerThumbprint='',
 [string]$SignTool=''
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleasePolicy.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'AssetPolicy.psm1') -Force
$sealResult=[ordered]@{Status='BLOCKED';Reasons=@();HelpersExecuted=0;Fees=0;TrustedSigning='NOT_APPROVED';SACIntegration='NOT_TESTED';Archive=$null}
try{
 $signerPin=$ApprovedSignerThumbprint.Trim().ToUpperInvariant()
 if($signerPin -notmatch '^[0-9A-F]{40}$'){throw 'SIGNING_IDENTITY_MISSING_OR_INVALID'}
 $buildRoot=Assert-CandidatePath (Join-Path $PSScriptRoot ('.out/'+$BuildName)) $PSScriptRoot
 $pluginRoot=Join-Path $buildRoot 'plugin'
 $record=Get-Content -LiteralPath (Join-Path $buildRoot 'build-record.json') -Raw -Encoding utf8 | ConvertFrom-Json
 $before=@(Get-CandidateInventory $pluginRoot)
 Assert-CandidateInventory @($record.ImmutableFiles) @($before|Where-Object {$_.Path -notin @('hooks/computer-use-voice-pretool.exe','native/computer_use_voice_notifier.exe')})
 $facts=@{Version=$record.Version;ApprovedSignerThumbprint=$signerPin;Helpers=@(Get-SignedHelperEvidence $pluginRoot $SignTool $signerPin)}
 $signatureGate=Test-ReleaseFacts $facts
 $sealResult.Helpers=$facts.Helpers
 $sealResult.Reasons=@($signatureGate.Reasons)
 if($record.ReviewOnly -or $null -eq $record.AssetFacts){$sealResult.Reasons+=@('APPROVED_WARNING_ASSET_MISSING')}else{
  $assetGate=Test-AssetFacts ($record.AssetFacts | ConvertTo-Json -Depth 8 | ConvertFrom-Json -AsHashtable)
  $sealResult.Reasons+=@($assetGate.Reasons)
 }
 $licensePath=Join-Path $PSScriptRoot 'LICENSE'
 $approvalPath=Join-Path $PSScriptRoot 'PUBLICATION-APPROVAL.json'
 if(-not (Test-Path -LiteralPath $licensePath) -or -not (Test-Path -LiteralPath $approvalPath)){
  $sealResult.Reasons+=@('CODE_LICENSE_AND_PUBLICATION_APPROVAL_PENDING')
 }else{
  $approval=Get-Content -LiteralPath $approvalPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
  if($approval.License -cnotin @('MIT','Apache-2.0') -or $approval.OwnAllSelectedSource -isnot [bool] -or $approval.OwnAllSelectedSource -ne $true -or $approval.PublishApproved -isnot [bool] -or $approval.PublishApproved -ne $true){
   $sealResult.Reasons+=@('OWNER_PUBLICATION_DECLARATION_REQUIRED')
  }
  $packedLicense=Join-Path $pluginRoot 'LICENSE'
  if(-not (Test-Path -LiteralPath $packedLicense) -or (Get-FileHash -LiteralPath $packedLicense -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash){
   $sealResult.Reasons+=@('APPROVED_LICENSE_NOT_IN_PACKAGE')
  }
 }
 if($sealResult.Reasons.Count){throw 'RELEASE_GATES_BLOCKED'}
 $releaseRoot=Assert-CandidatePath (Join-Path $PSScriptRoot ('.out/sealed-'+$BuildName)) $PSScriptRoot
 if(Test-Path -LiteralPath $releaseRoot){throw 'RELEASE_ALREADY_EXISTS_NO_OVERWRITE'}
 [void](New-Item -ItemType Directory -Path $releaseRoot)
 $streams=[Collections.Generic.List[IO.FileStream]]::new()
 try{
  foreach($entry in $before){$streams.Add([IO.File]::Open((Join-Path $pluginRoot $entry.Path),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))}
  Assert-CandidateInventory $before @(Get-CandidateInventory $pluginRoot)
  Add-Type -AssemblyName System.IO.Compression
  $archivePath=Join-Path $releaseRoot 'computer-use-voice-wrapper.zip'
  $archiveStream=[IO.File]::Open($archivePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try{
   $zip=[IO.Compression.ZipArchive]::new($archiveStream,[IO.Compression.ZipArchiveMode]::Create,$true)
   try{
    for($index=0;$index -lt $before.Count;$index++){
     $destination=$zip.CreateEntry($before[$index].Path).Open()
     try{$streams[$index].Position=0;$streams[$index].CopyTo($destination)}finally{$destination.Dispose()}
    }
   }finally{$zip.Dispose()}
  }finally{$archiveStream.Dispose()}
 }finally{foreach($stream in $streams){$stream.Dispose()}}
 $sealResult.Status='SIGNED_LOCAL_CANDIDATE_NOT_DEPLOYED'
 $sealResult.TrustedSigning='VERIFIED_NOT_A_SPONSOR_APPROVAL'
 $sealResult.Archive=[IO.Path]::GetFileName($archivePath)
 $sealResult.ArchiveSHA256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
 $sealResult.SignedInventory=$before
}catch{$sealResult.Reasons+=@($_.Exception.Message)}
$evidenceRoot=Assert-CandidatePath (Join-Path $PSScriptRoot '.out') $PSScriptRoot
[void](New-Item -ItemType Directory -Path $evidenceRoot -Force)
$sealResult | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $evidenceRoot ('seal-'+$BuildName+'-evidence.json')) -Encoding utf8
$sealResult | ConvertTo-Json -Depth 12
if($sealResult.Status -eq 'BLOCKED'){exit 3}
