# Local deterministic compile only. Never executes helpers or installs anything.
[CmdletBinding()]
param(
    [ValidatePattern('^[a-z0-9-]{1,32}$')][string]$BuildName='review-a',
    [switch]$ReviewOnly,
    [string]$WarningAssetPath='',
    [string]$AssetRightsPath=''
)
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows){throw 'WINDOWS_POWERSHELL_7_REQUIRED'}
Import-Module (Join-Path $PSScriptRoot 'ReleasePolicy.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'AssetPolicy.psm1') -Force
$buildRoot=Assert-CandidatePath (Join-Path $PSScriptRoot ('.out/'+$BuildName)) $PSScriptRoot
if(Test-Path -LiteralPath $buildRoot){throw 'BUILD_ALREADY_EXISTS_NO_OVERWRITE'}
$assetFacts=$null
if(-not $ReviewOnly){
    if(-not $WarningAssetPath -or -not $AssetRightsPath){throw 'APPROVED_WARNING_ASSET_REQUIRED'}
    $assetFacts=Get-Content -LiteralPath $AssetRightsPath -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
    $assetGate=Test-AssetFacts $assetFacts
    if(-not $assetGate.Allowed){throw ('ASSET_RIGHTS_BLOCKED:'+($assetGate.Reasons -join ','))}
    $assetFile=Get-Item -LiteralPath $WarningAssetPath
    if($assetFile.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'ASSET_REPARSE_POINT_REJECTED'}
    if($assetFile.Length -ne $assetFacts.Length -or (Get-FileHash -LiteralPath $WarningAssetPath -Algorithm SHA256).Hash -cne $assetFacts.SHA256){throw 'ASSET_BYTES_DO_NOT_MATCH_APPROVAL'}
}
$compilerEvidence=@()
foreach($compilerName in @('Microsoft.CodeAnalysis.dll','Microsoft.CodeAnalysis.CSharp.dll')){
    $compilerPath=Join-Path $PSHOME $compilerName
    Assert-MicrosoftTool $compilerPath
    $compilerEvidence += [pscustomobject]@{Name=$compilerName;Version=(Get-Item -LiteralPath $compilerPath).VersionInfo.FileVersion;SHA256=(Get-FileHash -LiteralPath $compilerPath -Algorithm SHA256).Hash;Authenticode='Valid Microsoft'}
    Add-Type -Path $compilerPath
}
$frameworkRoot=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$references=[Collections.Generic.List[Microsoft.CodeAnalysis.MetadataReference]]::new()
$referenceEvidence=@()
foreach($referenceName in @('mscorlib.dll','System.dll','System.Core.dll','System.Web.Extensions.dll')){
    $referencePath=Join-Path $frameworkRoot $referenceName
    $references.Add([Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($referencePath))
    $referenceEvidence += [pscustomobject]@{Name=$referenceName;SHA256=(Get-FileHash -LiteralPath $referencePath -Algorithm SHA256).Hash}
}
$pluginRoot=Join-Path $buildRoot 'plugin'
[void](New-Item -ItemType Directory -Path $pluginRoot)
$runtimeFiles=@(
 '.codex-plugin/plugin.json','hooks/hooks.json','hooks/src/ComputerUseVoicePreTool.cs',
 'native/src/ComputerUseVoiceNotifier.cs','native/src/WarningAssetPin.cs','src/AssemblyInfo.cs',
 'skills/computer-use-voice/SKILL.md',
 'skills/computer-use-voice/helper/create_voice_wrapped_sky.mjs',
 'skills/computer-use-voice/helper/initialize_voice_wrapped_sky.mjs',
 'skills/computer-use-voice/helper/notifier_client.mjs'
)
foreach($runtimeFile in $runtimeFiles){
    $runtimeTarget=Assert-CandidatePath (Join-Path $pluginRoot $runtimeFile) $PSScriptRoot
    [void](New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($runtimeTarget)) -Force)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $runtimeFile) -Destination $runtimeTarget
}
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'LICENSE')){
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'LICENSE') -Destination (Join-Path $pluginRoot 'LICENSE')
}
if(-not $ReviewOnly){
    Copy-Item -LiteralPath $WarningAssetPath -Destination (Join-Path $pluginRoot 'native/warning_zh_cn.wav')
    if((Get-FileHash -LiteralPath (Join-Path $pluginRoot 'native/warning_zh_cn.wav') -Algorithm SHA256).Hash -cne $assetFacts.SHA256){throw 'ASSET_COPY_CHANGED'}
    $assetPinSource="namespace ComputerUseVoice { internal static class WarningAssetPin { internal const long Length = "+$assetFacts.Length+"; internal const string Sha256 = "+'"'+$assetFacts.SHA256+'"; } }'
    [IO.File]::WriteAllText((Join-Path $pluginRoot 'native/src/WarningAssetPin.cs'),$assetPinSource,[Text.UTF8Encoding]::new($false))
    $assetFacts | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $pluginRoot 'native/asset-rights.json') -Encoding utf8
}
$immutableFiles=@(Get-CandidateInventory $pluginRoot)
$compileResults=@()
foreach($compileJob in @(
 @{Name='computer-use-voice-pretool';Sources=@('hooks/src/ComputerUseVoicePreTool.cs','src/AssemblyInfo.cs');Target='hooks/computer-use-voice-pretool.exe'},
 @{Name='computer_use_voice_notifier';Sources=@('native/src/ComputerUseVoiceNotifier.cs','native/src/WarningAssetPin.cs','src/AssemblyInfo.cs');Target='native/computer_use_voice_notifier.exe'}
)){
    $syntaxTrees=[Collections.Generic.List[Microsoft.CodeAnalysis.SyntaxTree]]::new()
    foreach($sourceFile in $compileJob.Sources){
        $sourceText=[IO.File]::ReadAllText((Join-Path $pluginRoot $sourceFile),[Text.Encoding]::UTF8)
        $syntaxTrees.Add([Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($sourceText,[Microsoft.CodeAnalysis.CSharp.CSharpParseOptions]::Default,$sourceFile,[Text.Encoding]::UTF8,[Threading.CancellationToken]::None))
    }
    $compileOptions=[Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::WindowsApplication)
    $compileOptions=$compileOptions.WithOptimizationLevel([Microsoft.CodeAnalysis.OptimizationLevel]::Release).WithDeterministic($true)
    $compilation=[Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create($compileJob.Name,$syntaxTrees,$references,$compileOptions)
    $compileOutput=[IO.File]::Open((Join-Path $pluginRoot $compileJob.Target),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $versionResources=$compilation.CreateDefaultWin32Resources($true,$false,$null,$null)
    try{$compileResult=$compilation.Emit($compileOutput,$null,$null,$versionResources)}finally{$versionResources.Dispose();$compileOutput.Dispose()}
    if(-not $compileResult.Success){throw ('COMPILATION_FAILED:'+($compileResult.Diagnostics -join ' | '))}
    $compileResults += [pscustomobject]@{Target=$compileJob.Target;Success=$true;Deterministic=$true;SourcePaths='Relative only'}
}
$buildRecord=[ordered]@{
 Schema='computer-use-voice-public-review-build-v1';Version='0.2.0+review.20261010'
 Status=$(if($ReviewOnly){'REVIEW_ONLY_NONRUNNABLE_NO_WARNING_ASSET'}else{'ASSET_DECLARATIONS_ACCEPTED_REQUIRES_SIGNING_AND_LICENSE'})
 ReviewOnly=[bool]$ReviewOnly;AssetFacts=$assetFacts;HelpersExecuted=0;DesktopActions=0;Fees=0
 Compiler=$compilerEvidence;References=$referenceEvidence;CompileResults=$compileResults
 ImmutableFiles=$immutableFiles;Inventory=@(Get-CandidateInventory $pluginRoot)
}
$buildRecord | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $buildRoot 'build-record.json') -Encoding utf8
[pscustomobject]@{BuildName=$BuildName;Status=$buildRecord.Status;CompiledHelpers=2;HelpersExecuted=0;Deterministic=$true} | ConvertTo-Json
