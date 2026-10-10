# Synthetic signature facts only. No executables, certificate access, network, or desktop control.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleasePolicy.psm1') -Force
$diagPin='1111111111111111111111111111111111111111'
$diagHash='A'*64
function New-TestFacts {
    @{
        Version='0.2.0+review.20261010';ApprovedSignerThumbprint=$diagPin
        Helpers=@(
            @{RelativePath='hooks/computer-use-voice-pretool.exe';SignatureStatus='Valid';SignerThumbprint=$diagPin;TimestampThumbprint=('2'*40);SignToolExitCode=[int]0;SHA256Before=$diagHash;SHA256After=$diagHash},
            @{RelativePath='native/computer_use_voice_notifier.exe';SignatureStatus='Valid';SignerThumbprint=$diagPin;TimestampThumbprint=('2'*40);SignToolExitCode=[int]0;SHA256Before=$diagHash;SHA256After=$diagHash}
        )
    }
}
$diagTests=[Collections.Generic.List[object]]::new()
function Check-Decision([string]$Name,[hashtable]$Facts,[bool]$Expected) {
    $diagResult=Test-ReleaseFacts $Facts
    if($diagResult.Allowed -ne $Expected){throw "FAILED:$Name"}
    $diagTests.Add([pscustomobject]@{Name=$Name;Passed=$true;ExpectedAllowed=$Expected;Reasons=$diagResult.Reasons})
}
Check-Decision 'valid_synthetic_facts_pass_policy_only' (New-TestFacts) $true
foreach($diagIndex in @(0,1)){
    foreach($diagStatus in @('NotSigned','HashMismatch','NotTrusted','UnknownError')){
        $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].SignatureStatus=$diagStatus
        Check-Decision ("helper_{0}_{1}_blocked" -f $diagIndex,$diagStatus) $diagFacts $false
    }
    $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].SignerThumbprint='3'*40
    Check-Decision ("helper_{0}_wrong_signer_blocked" -f $diagIndex) $diagFacts $false
    $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].TimestampThumbprint=$null
    Check-Decision ("helper_{0}_timestamp_missing_blocked" -f $diagIndex) $diagFacts $false
    $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].SignToolExitCode=[int]1
    Check-Decision ("helper_{0}_sign_or_timestamp_verification_failure_blocked" -f $diagIndex) $diagFacts $false
    $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].SignToolExitCode=$null
    Check-Decision ("helper_{0}_verification_absent_blocked" -f $diagIndex) $diagFacts $false
    $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].SHA256After='B'*64
    Check-Decision ("helper_{0}_changed_after_verify_blocked" -f $diagIndex) $diagFacts $false
    $diagFacts=New-TestFacts;$diagFacts.Helpers[$diagIndex].SHA256Before=''
    Check-Decision ("helper_{0}_signed_hash_absent_blocked" -f $diagIndex) $diagFacts $false
}
$diagFacts=New-TestFacts;$diagFacts.ApprovedSignerThumbprint=''
Check-Decision 'signing_identity_absent_blocked' $diagFacts $false
$diagFacts=New-TestFacts;$diagFacts.Helpers=@($diagFacts.Helpers[0])
Check-Decision 'one_signed_helper_insufficient' $diagFacts $false
$diagFacts=New-TestFacts;$diagFacts.Helpers=@($diagFacts.Helpers[0],$diagFacts.Helpers[0])
Check-Decision 'duplicate_helper_cannot_replace_notifier' $diagFacts $false
$diagFacts=New-TestFacts;$diagFacts.Helpers[1].RelativePath='native/renamed.exe'
Check-Decision 'renamed_helper_blocked' $diagFacts $false
$diagFacts=New-TestFacts;$diagFacts.Helpers+=@{RelativePath='extra.exe'}
Check-Decision 'extra_executable_blocked' $diagFacts $false
$diagFacts=New-TestFacts;$diagFacts.Version='0.1.0+resigned'
Check-Decision 'unchanged_package_version_blocked' $diagFacts $false
$diagFacts=New-TestFacts;$diagFacts.Helpers[0].Remove('SignatureStatus')
Check-Decision 'missing_signature_evidence_blocked' $diagFacts $false
$diagInventory=@([pscustomobject]@{Path='hooks/hooks.json';SHA256=$diagHash;Length=10})
foreach($diagCase in @(
    @{Name='immutable_content_tamper_blocked';Actual=@([pscustomobject]@{Path='hooks/hooks.json';SHA256=('B'*64);Length=10})},
    @{Name='immutable_size_tamper_blocked';Actual=@([pscustomobject]@{Path='hooks/hooks.json';SHA256=$diagHash;Length=11})},
    @{Name='extra_package_file_blocked';Actual=@($diagInventory[0],[pscustomobject]@{Path='unknown.ps1';SHA256=$diagHash;Length=10})}
)){
    $diagCaught=$false
    try{Assert-CandidateInventory $diagInventory $diagCase.Actual}catch{$diagCaught=$true}
    if(-not $diagCaught){throw "FAILED:$($diagCase.Name)"}
    $diagTests.Add([pscustomobject]@{Name=$diagCase.Name;Passed=$true;ExpectedAllowed=$false})
}
$diagCaught=$false
try{[void](Assert-CandidatePath (Join-Path (Split-Path $PSScriptRoot -Parent) 'outside-candidate') $PSScriptRoot)}catch{$diagCaught=$true}
if(-not $diagCaught){throw 'FAILED:write_scope_escape'}
$diagTests.Add([pscustomobject]@{Name='production_path_write_rejected';Passed=$true;ExpectedAllowed=$false})
$diagEvidence=[ordered]@{Status='PASS';Count=$diagTests.Count;Tests=$diagTests.ToArray();SyntheticFactsOnly=$true;HelperExecutions=0;NetworkCalls=0;ActualTrustedSigning='BLOCKED';SACIntegration='BLOCKED'}
$diagEvidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'policy-test-evidence.json') -Encoding utf8
$diagEvidence | ConvertTo-Json -Depth 10
