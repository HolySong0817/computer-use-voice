# Warning recording supplied separately

No WAV or TTS generator is included. The existing system-generated voice asset remains excluded because its output rights and precise voice provenance were not established.

The shortest clean path is an original recording made by the maintainer, with no third-party voice imitation, music or reused clip. Preparing this project does not make that recording or approve its rights.

1. Record the exact sentence: **注意，Codex 即將接管电脑。**
2. A person listens to the complete WAV, verifies its words and suitability for Windows SoundPlayer, and confirms ownership and permission to distribute it under the selected MIT or Apache-2.0 asset license.
3. Create a private approval JSON using assets/asset-rights.example.json. Fill the holder, license, declarations, evidence reference, byte length and uppercase SHA256. Do not put credentials or private contact details into it. The empty example cannot authorize an asset.
4. Only after those declarations are true, use Build.ps1 with BuildName, WarningAssetPath and AssetRightsPath. This copies the exact approved bytes and generates hash/size pins only inside isolated output. It does not play the file or prove the declarations.
5. Any changed audio requires new rights/content review, hashes, rebuild and release review. Public disclosure of the final rights notice also needs approval.

The notifier still verifies fixed asset bytes and reports ordered playback events. The wrapper still waits at least 2000 ms and rejects missing or failed playback. The review build's empty pins deliberately prevent use. Real playback, trusted signing and host/SAC tests remain separate and unperformed.
