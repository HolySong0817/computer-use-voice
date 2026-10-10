# Source and dependency inventory

| Component | In this tree? | Provenance / rights status | Publication handling |
| --- | --- | --- | --- |
| Pretool and notifier C# source | Yes | Owner states self-made and confirms authority to publish/license; original files had no notices. No independent copyright-chain audit claimed. | MIT with HolySong0817 attribution. |
| Wrapper, runtime discovery, notifier client and original mock tests | Yes | Same confirmed owner declaration; no embedded third-party notice found. Interface use alone does not prove authorship. | MIT; no SDK implementation copied. |
| New build, asset and release gates, metadata and documentation | Yes | Prepared locally for this project and included in the owner's approved scope. | MIT with HolySong0817 attribution. |
| Original warning WAV | No | Its generator uses Windows.Media.SpeechSynthesis and selects a Chinese installed voice. No voice-provider/output redistribution grant was found in the source. | Excluded; no inferred license. |
| Original TTS generator and audio sidecar/fault tests | No | Not required for the source-only review; do not redistribute unverified speech output. | Excluded. |
| User-supplied future recording | No | Must have an owner declaration, matching transcript, evidence, hash and explicit MIT or Apache-2.0 asset grant. | Missing; operational build blocked by default. |
| Node.js and node:* built-ins | External only | Node core is MIT; its distribution includes additional third-party notices. | No runtime or built-in implementation bundled. See [Node license](https://github.com/nodejs/node/blob/v24.19.0/LICENSE). |
| PowerShell / Microsoft Roslyn compiler assemblies | External build tools | Supplied by the locally installed Microsoft-signed PowerShell distribution; Roslyn's upstream license is MIT. | Do not bundle compiler or runtime DLLs; record exact hashes. See [Roslyn license](https://github.com/dotnet/roslyn/blob/main/License.txt). |
| Windows .NET Framework libraries | External system prerequisite | Microsoft platform licensing, not a license granted by this project. Source references System, System.Core, System.Web.Extensions, mscorlib and platform SoundPlayer. | No DLLs copied; users obtain platform prerequisites under their own terms. |
| Host-provided @oai/sky and Codex application | External runtime only | Redistribution permission has not been established here. Runtime metadata/API checks are interoperability code, not a sublicense of the host. | Exclude host/SDK files, cache, accounts and runtime binaries. Host terms apply; SignPath must assess this external dependency boundary. |

No npm package dependency is vendored or downloaded. This is a source review inventory, not a certificate of ownership or an assertion that the project already meets SignPath eligibility.

The Microsoft [SpeechSynthesizer API documentation](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer) describes generation mechanics; it is not evidence of a redistribution grant for the existing WAV.
