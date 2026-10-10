namespace ComputerUseVoice
{
    // No audio is distributed. These deliberately invalid pins keep the review build fail-closed.
    // Build.ps1 generates a replacement in its isolated output only after asset rights approval.
    internal static class WarningAssetPin
    {
        internal const long Length = 0;
        internal const string Sha256 = "";
    }
}
