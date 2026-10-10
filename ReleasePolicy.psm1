# Pure release decisions and local file verification. No signing, installation, or helper execution.
$script:RequiredHelpers = @('hooks/computer-use-voice-pretool.exe','native/computer_use_voice_notifier.exe')

function Test-ReleaseFacts {
    param([Parameter(Mandatory)][hashtable]$Facts)
    $diagReasons = [Collections.Generic.List[string]]::new()
    $diagPin = ([string]$Facts['ApprovedSignerThumbprint']).Trim().ToUpperInvariant()
    if ($diagPin -notmatch '^[0-9A-F]{40}$') { $diagReasons.Add('SIGNING_IDENTITY_MISSING_OR_INVALID') }
    try {
        $diagVersion = [string]$Facts['Version']
        if ($diagVersion -notmatch '^\d+\.\d+\.\d+(?:\+[A-Za-z0-9.-]+)?$' -or
            [version]($diagVersion.Split('+')[0]) -le [version]'0.1.0') {
            $diagReasons.Add('NEW_RELEASE_VERSION_REQUIRED')
        }
    } catch { $diagReasons.Add('NEW_RELEASE_VERSION_REQUIRED') }
    $diagEvidence = @($Facts['Helpers'])
    if ($diagEvidence.Count -ne 2) { $diagReasons.Add('EXACTLY_TWO_HELPERS_REQUIRED') }
    $diagSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($diagItem in $diagEvidence) {
        if ($diagItem -isnot [Collections.IDictionary]) { $diagReasons.Add('INVALID_HELPER_EVIDENCE'); continue }
        $diagPath = [string]$diagItem['RelativePath']
        if ($diagPath -cnotin $script:RequiredHelpers -or -not $diagSeen.Add($diagPath)) {
            $diagReasons.Add('UNKNOWN_OR_DUPLICATE_HELPER'); continue
        }
        if ([string]$diagItem['SignatureStatus'] -cne 'Valid') { $diagReasons.Add("UNTRUSTED_SIGNATURE:$diagPath") }
        if ([string]$diagItem['SignerThumbprint'] -cne $diagPin) { $diagReasons.Add("SIGNER_PIN_MISMATCH:$diagPath") }
        if ([string]$diagItem['TimestampThumbprint'] -notmatch '^[0-9A-F]{40}$') { $diagReasons.Add("TRUSTED_TIMESTAMP_REQUIRED:$diagPath") }
        if ($diagItem['SignToolExitCode'] -isnot [int] -or $diagItem['SignToolExitCode'] -ne 0) {
            $diagReasons.Add("SIGNTOOL_ALL_SIGNATURES_VERIFY_FAILED:$diagPath")
        }
        if ([string]$diagItem['SHA256Before'] -notmatch '^[0-9A-F]{64}$' -or
            [string]$diagItem['SHA256After'] -cne [string]$diagItem['SHA256Before']) {
            $diagReasons.Add("SIGNED_HASH_MISSING_OR_CHANGED:$diagPath")
        }
    }
    foreach ($diagRequired in $script:RequiredHelpers) {
        if (-not $diagSeen.Contains($diagRequired)) { $diagReasons.Add("MISSING_HELPER:$diagRequired") }
    }
    [pscustomobject]@{Allowed=($diagReasons.Count -eq 0);Status=$(if($diagReasons.Count){'BLOCKED'}else{'SIGNATURE_GATE_PASS'});Reasons=$diagReasons.ToArray()}
}

function Assert-CandidatePath {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$PackageRoot)
    $diagRoot = [IO.Path]::GetFullPath($PackageRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $diagPath = [IO.Path]::GetFullPath($Path)
    if (-not $diagPath.StartsWith($diagRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'WRITE_OUTSIDE_ISOLATED_PACKAGE_REJECTED'
    }
    $diagCurrent = $diagPath
    while ($diagCurrent -and $diagCurrent.Length -ge $diagRoot.Length) {
        if (Test-Path -LiteralPath $diagCurrent) {
            if ((Get-Item -LiteralPath $diagCurrent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'REPARSE_POINT_REJECTED'
            }
        }
        $diagCurrent = [IO.Path]::GetDirectoryName($diagCurrent)
    }
    $diagPath
}

function Assert-MicrosoftTool {
    param([Parameter(Mandatory)][string]$Path)
    $diagSignature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
    if ($diagSignature.Status.ToString() -cne 'Valid' -or
        $diagSignature.SignerCertificate.Subject -notmatch '(^|,\s*)O="?Microsoft Corporation"?(,|$)') {
        throw 'TRUSTED_MICROSOFT_TOOL_REQUIRED'
    }
}

function Get-CandidateInventory {
    param([Parameter(Mandatory)][string]$Root)
    $diagPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    foreach ($diagItem in Get-ChildItem -LiteralPath $Root -Force -Recurse) {
        if ($diagItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'REPARSE_POINT_REJECTED' }
        if (-not $diagItem.PSIsContainer) {
            [pscustomobject]@{Path=$diagItem.FullName.Substring($diagPrefix.Length).Replace('\','/');SHA256=(Get-FileHash -LiteralPath $diagItem.FullName -Algorithm SHA256).Hash;Length=$diagItem.Length}
        }
    }
}

function Assert-CandidateInventory {
    param([Parameter(Mandatory)][object[]]$Expected,[Parameter(Mandatory)][object[]]$Actual)
    if ($Expected.Count -ne $Actual.Count) { throw 'PACKAGE_FILE_SET_CHANGED' }
    $diagMap = @{}
    foreach ($diagEntry in $Actual) {
        if ($diagMap.ContainsKey($diagEntry.Path)) { throw 'DUPLICATE_PACKAGE_PATH' }
        $diagMap[$diagEntry.Path] = $diagEntry
    }
    foreach ($diagEntry in $Expected) {
        if (-not $diagMap.ContainsKey($diagEntry.Path) -or
            $diagMap[$diagEntry.Path].SHA256 -cne $diagEntry.SHA256 -or
            $diagMap[$diagEntry.Path].Length -ne $diagEntry.Length) { throw "PACKAGE_HASH_OR_SIZE_CHANGED:$($diagEntry.Path)" }
    }
}

function Get-SignedHelperEvidence {
    param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][AllowEmptyString()][string]$SignTool,[Parameter(Mandatory)][string]$ApprovedSignerThumbprint)
    $diagPin = $ApprovedSignerThumbprint.Trim().ToUpperInvariant()
    foreach ($diagRelative in $script:RequiredHelpers) {
        $diagPath = Join-Path $Root $diagRelative
        # Hold the exact file against writes/deletion for the entire signature/hash check.
        $diagLock = [IO.File]::Open($diagPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        try {
        $diagBefore = (Get-FileHash -LiteralPath $diagPath -Algorithm SHA256).Hash
        $diagSig = Get-AuthenticodeSignature -LiteralPath $diagPath -ErrorAction Stop
        $diagVerifyExit = -1
        $diagVerifyOutput = @()
        if ($diagSig.Status.ToString() -ceq 'Valid' -and $diagSig.SignerCertificate.Thumbprint -ceq $diagPin -and $diagSig.TimeStamperCertificate) {
            Assert-MicrosoftTool $SignTool
            # Reads the PE signatures; does not launch the candidate helper. /all rejects a bad secondary signature.
            $diagVerifyOutput = @(& $SignTool verify /pa /all /v /tw $diagPath 2>&1 | ForEach-Object { "$_" })
            $diagVerifyExit = [int]$LASTEXITCODE
        }
        @{
            RelativePath=$diagRelative;SignatureStatus=$diagSig.Status.ToString()
            SignerThumbprint=$diagSig.SignerCertificate.Thumbprint;SignerSubject=$diagSig.SignerCertificate.Subject
            TimestampThumbprint=$diagSig.TimeStamperCertificate.Thumbprint
            SignToolExitCode=[int]$diagVerifyExit;SignToolOutput=$diagVerifyOutput
            SHA256Before=$diagBefore;SHA256After=(Get-FileHash -LiteralPath $diagPath -Algorithm SHA256).Hash
        }
        } finally { $diagLock.Dispose() }
    }
}

Export-ModuleMember -Function Test-ReleaseFacts,Assert-CandidatePath,Assert-MicrosoftTool,Get-CandidateInventory,Assert-CandidateInventory,Get-SignedHelperEvidence
