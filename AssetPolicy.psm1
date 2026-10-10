# Rights fields are human declarations, not an independent legal certification.
function Test-AssetFacts {
    param([Parameter(Mandatory)][hashtable]$Facts)
    $assetReasons=[Collections.Generic.List[string]]::new()
    if($Facts.SourceKind -cne 'OwnRecording'){$assetReasons.Add('OWN_RECORDING_REQUIRED')}
    if([string]::IsNullOrWhiteSpace([string]$Facts.RightsHolder)){$assetReasons.Add('RIGHTS_HOLDER_REQUIRED')}
    if([string]$Facts.License -cnotin @('MIT','Apache-2.0')){$assetReasons.Add('APPROVED_ASSET_LICENSE_REQUIRED')}
    foreach($assetFlag in @('RedistributionApproved','TranscriptReviewed','NoThirdPartyVoiceOrMusic')){
        if($Facts[$assetFlag] -isnot [bool] -or $Facts[$assetFlag] -ne $true){$assetReasons.Add("HUMAN_DECLARATION_REQUIRED:$assetFlag")}
    }
    if([string]$Facts.WarningText -cne '注意，Codex 即將接管电脑。'){$assetReasons.Add('FIXED_WARNING_TEXT_REQUIRED')}
    if([string]$Facts.SHA256 -cnotmatch '^[0-9A-F]{64}$'){$assetReasons.Add('ASSET_SHA256_REQUIRED')}
    if(($Facts.Length -isnot [long] -and $Facts.Length -isnot [int]) -or $Facts.Length -le 44){$assetReasons.Add('ASSET_LENGTH_REQUIRED')}
    if([string]::IsNullOrWhiteSpace([string]$Facts.RightsEvidence)){$assetReasons.Add('RIGHTS_EVIDENCE_REQUIRED')}
    [pscustomobject]@{Allowed=($assetReasons.Count -eq 0);Status=$(if($assetReasons.Count){'BLOCKED'}else{'DECLARATIONS_ACCEPTED_NOT_INDEPENDENTLY_CERTIFIED'});Reasons=$assetReasons.ToArray()}
}
Export-ModuleMember -Function Test-AssetFacts
