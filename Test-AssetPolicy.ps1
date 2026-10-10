$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'AssetPolicy.psm1') -Force
function New-AssetTestFacts {
    @{SourceKind='OwnRecording';RightsHolder='Test maintainer';License='MIT';RedistributionApproved=$true;TranscriptReviewed=$true;NoThirdPartyVoiceOrMusic=$true;WarningText='注意，Codex 即將接管电脑。';SHA256=('A'*64);Length=[long]1000;RightsEvidence='Synthetic ownership statement'}
}
$assetTests=[Collections.Generic.List[object]]::new()
function Check-Asset([string]$Name,[hashtable]$Facts,[bool]$Expected) {
    $assetDecision=Test-AssetFacts $Facts
    if($assetDecision.Allowed -ne $Expected){throw "FAILED:$Name"}
    $assetTests.Add([pscustomobject]@{Name=$Name;Passed=$true;ExpectedAllowed=$Expected;Reasons=$assetDecision.Reasons})
}
Check-Asset 'synthetic_own_recording_declarations_pass_only_policy' (New-AssetTestFacts) $true
foreach($assetCase in @(
 @{Name='unknown_source';Key='SourceKind';Value='Unknown'},
 @{Name='tts_voice_rights_unproven';Key='SourceKind';Value='SystemTTS'},
 @{Name='owner_missing';Key='RightsHolder';Value=''},
 @{Name='license_missing';Key='License';Value=''},
 @{Name='proprietary_license';Key='License';Value='AllRightsReserved'},
 @{Name='redistribution_not_approved';Key='RedistributionApproved';Value=$false},
 @{Name='approval_string_not_boolean';Key='RedistributionApproved';Value='true'},
 @{Name='transcript_not_reviewed';Key='TranscriptReviewed';Value=$false},
 @{Name='third_party_voice_unproven';Key='NoThirdPartyVoiceOrMusic';Value=$false},
 @{Name='warning_text_changed';Key='WarningText';Value='Different notice'},
 @{Name='hash_missing';Key='SHA256';Value=''},
 @{Name='size_zero';Key='Length';Value=[long]0},
 @{Name='rights_evidence_missing';Key='RightsEvidence';Value=''}
)){
    $assetFacts=New-AssetTestFacts;$assetFacts[$assetCase.Key]=$assetCase.Value
    Check-Asset $assetCase.Name $assetFacts $false
}
$assetExample=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'assets/asset-rights.example.json') -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
Check-Asset 'unfilled_example_cannot_authorize_asset' $assetExample $false
$assetEvidence=[ordered]@{Status='PASS';Count=$assetTests.Count;Tests=$assetTests.ToArray();SyntheticOnly=$true;AudioPlayed=0;IndependentRightsCertification=$false}
$assetEvidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'asset-test-evidence.json') -Encoding utf8
$assetEvidence | ConvertTo-Json -Depth 8
