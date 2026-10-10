# Offline review: no helper execution, audio playback, real host import or desktop action.
[CmdletBinding()]
param([ValidatePattern('^[a-z0-9-]{1,24}$')][string]$BuildPrefix='verify')
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleasePolicy.psm1') -Force
$parseEvidence=@()
foreach($scriptFile in @('Build.ps1','Seal-Release.ps1','Verify.ps1','Test-ReleasePolicy.ps1','Test-AssetPolicy.ps1','ReleasePolicy.psm1','AssetPolicy.psm1')){
    $parseTokens=$null;$parseErrors=$null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $scriptFile),[ref]$parseTokens,[ref]$parseErrors)
    if($parseErrors.Count){throw "SCRIPT_PARSE_FAILED:$scriptFile"}
    $parseEvidence += [pscustomobject]@{File=$scriptFile;Status='PASS'}
}
& (Join-Path $PSScriptRoot 'Test-ReleasePolicy.ps1') | Out-Null
& (Join-Path $PSScriptRoot 'Test-AssetPolicy.ps1') | Out-Null
$nodeCommand=Get-Command node -ErrorAction Stop
$mockEvidence=@()
foreach($mockFile in @('tests/warning_gate_offline_tests.mjs','tests/global_wrapper_offline_tests.mjs')){
    $mockOutput=@(& $nodeCommand.Source (Join-Path $PSScriptRoot $mockFile) 2>&1 | ForEach-Object {"$_"})
    if($LASTEXITCODE -ne 0){throw "MOCK_TEST_FAILED:$mockFile"}
    $mockJson=($mockOutput -join [Environment]::NewLine) | ConvertFrom-Json
    if($mockJson.failed -ne 0 -or $mockJson.computer_use_triggered -or $mockJson.notifier_process_triggered){throw 'MOCK_SAFETY_ASSERTION_FAILED'}
    $mockEvidence += $mockJson
}
$buildNames=@(($BuildPrefix+'-a'),($BuildPrefix+'-b'))
foreach($buildName in $buildNames){
    & (Join-Path $PSScriptRoot 'Build.ps1') -ReviewOnly -BuildName $buildName | Out-Null
}
$buildA=Get-Content -LiteralPath (Join-Path $PSScriptRoot ('.out/'+$buildNames[0]+'/build-record.json')) -Raw -Encoding utf8 | ConvertFrom-Json
$buildB=Get-Content -LiteralPath (Join-Path $PSScriptRoot ('.out/'+$buildNames[1]+'/build-record.json')) -Raw -Encoding utf8 | ConvertFrom-Json
Assert-CandidateInventory @($buildA.Inventory) @($buildB.Inventory)
$helperEvidence=@()
foreach($helperPath in @('hooks/computer-use-voice-pretool.exe','native/computer_use_voice_notifier.exe')){
    $helperA=Join-Path $PSScriptRoot ('.out/'+$buildNames[0]+'/plugin/'+$helperPath)
    $helperB=Join-Path $PSScriptRoot ('.out/'+$buildNames[1]+'/plugin/'+$helperPath)
    $hashA=(Get-FileHash -LiteralPath $helperA -Algorithm SHA256).Hash
    $hashB=(Get-FileHash -LiteralPath $helperB -Algorithm SHA256).Hash
    if($hashA -cne $hashB){throw 'DETERMINISTIC_BUILD_HASH_MISMATCH'}
    $metadata=(Get-Item -LiteralPath $helperA).VersionInfo
    if($metadata.ProductName -cne 'Computer Use Voice' -or $metadata.FileVersion -cne '0.2.0.0' -or $metadata.ProductVersion -cne '0.2.0+review.20261010'){throw 'PRODUCT_METADATA_INVALID'}
    $helperEvidence += [pscustomobject]@{Path=$helperPath;SHA256=$hashA;TwoBuildsIdentical=$true;Signature=(Get-AuthenticodeSignature -LiteralPath $helperA).Status.ToString();ProductName=$metadata.ProductName;ProductVersion=$metadata.ProductVersion}
}
$hostExecutable=Join-Path $PSHOME 'pwsh.exe'
Assert-MicrosoftTool $hostExecutable
$negativeSeals=@()
foreach($sealCase in @(@{Name='missing-identity';Pin=''},@{Name='unsigned-and-missing-rights';Pin=('1'*40)})){
    $sealArgs=@('-NoProfile','-File',(Join-Path $PSScriptRoot 'Seal-Release.ps1'),'-BuildName',$buildNames[0])
    if($sealCase.Pin){$sealArgs+=@('-ApprovedSignerThumbprint',$sealCase.Pin)}
    $sealOutput=@(& $hostExecutable @sealArgs 2>&1 | ForEach-Object {"$_"})
    $sealExit=$LASTEXITCODE
    $sealText=$sealOutput -join [Environment]::NewLine
    $jsonStart=$sealText.IndexOf('{')
    if($jsonStart -lt 0){throw 'SEAL_JSON_EVIDENCE_MISSING'}
    $sealJson=$sealText.Substring($jsonStart) | ConvertFrom-Json
    if($sealExit -ne 3 -or $sealJson.Status -ne 'BLOCKED' -or $sealJson.Archive){throw 'NEGATIVE_RELEASE_SEAL_FAILED'}
    if($sealCase.Pin -and (@($sealJson.Helpers).Count -ne 2 -or @($sealJson.Helpers|Where-Object {$_.SignatureStatus -ne 'NotSigned'}).Count -ne 0 -or $sealJson.Reasons -notcontains 'APPROVED_WARNING_ASSET_MISSING' -or $sealJson.Reasons -notcontains 'CODE_LICENSE_AND_PUBLICATION_APPROVAL_PENDING')){throw 'UNSIGNED_AND_RIGHTS_GATES_NOT_OBSERVED'}
    $negativeSeals += [pscustomobject]@{Case=$sealCase.Name;ExitCode=$sealExit;Evidence=$sealJson}
}
$releasePolicy=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'policy-test-evidence.json') -Raw -Encoding utf8 | ConvertFrom-Json
$assetPolicy=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'asset-test-evidence.json') -Raw -Encoding utf8 | ConvertFrom-Json
$verifyEvidence=[ordered]@{
 Status='PASS_LOCAL_SOURCE_REVIEW';ScriptParse=$parseEvidence
 ReleasePolicy=$releasePolicy;AssetPolicy=$assetPolicy;MockTests=$mockEvidence
 NodeVersion=(& $nodeCommand.Source --version);PowerShellVersion=$PSVersionTable.PSVersion.ToString()
 DeterministicHelpers=$helperEvidence;Compiler=$buildA.Compiler;References=$buildA.References;NegativeSeals=$negativeSeals
 HelpersExecuted=0;AudioPlayed=0;RealRuntimeImported=$false;DesktopActions=0
    LicenseGranted=(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'LICENSE'));CodeLicense='MIT';AudioRightsProven=$false;Published=$false;TrustedSigning='BLOCKED';SACIntegration='NOT_TESTED';Fees=0
}
$verifyEvidence | ConvertTo-Json -Depth 18 | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.out/verify-evidence.json') -Encoding utf8
[pscustomobject]@{Status=$verifyEvidence.Status;ScriptParse=$parseEvidence.Count;ReleasePolicyTests=$releasePolicy.Count;AssetPolicyTests=$assetPolicy.Count;MockTests=(@($mockEvidence.passed)|Measure-Object -Sum).Sum;DeterministicHelpers=2;NegativeSeals=2;HelpersExecuted=0;AudioPlayed=0;Published=$false;LicenseGranted=$verifyEvidence.LicenseGranted;CodeLicense='MIT';Fees=0} | ConvertTo-Json
