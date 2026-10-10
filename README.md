# Computer Use Voice

MIT-licensed source-only third-party Windows warning gate maintained by HolySong0817. This is not an official OpenAI product and is not endorsed by OpenAI. This edition contains source, tests and documentation only: no signed helper, warning WAV or usable installation release.

The intended function is one fixed Chinese voice notice before supported Computer Use controls, with ordered playback evidence and a wait of at least 2000 ms. Read-only observations stay silent. Failed playback, missing assets, timeouts, invalid evidence and runtime/API mismatches deny control.

The original warning text is preserved exactly: **注意，Codex 即將接管电脑。**

## Current limits

- No warning audio is included because redistribution rights were not established. The review build deliberately uses invalid empty audio pins and cannot directly perform the intended function.
- No trusted signatures or signing-service approval exist. Compiled review helpers must not be launched or installed.
- Compatibility covers only the source's existing Node REPL hook and 13-method runtime contract. Current Codex integration and Smart App Control acceptance are untested; a valid signature would not guarantee acceptance.
- There is no remote CI, service account, secret, payment, certificate import, security-setting change or automatic installation in this project.

## Local build and tests

Use Windows and PowerShell 7 with its installed, valid Microsoft-signed Roslyn assemblies, the Windows .NET Framework reference assemblies and an installed Node.js 20+ runtime. Nothing is downloaded. The build records exact compiler and reference hashes; matching builds require the same toolchain and inputs.

~~~powershell
.\Verify.ps1
~~~

Verify runs mock-only tests, creates two deterministic review builds in .out/verify-a and .out/verify-b, compares both helper hashes and checks that unsigned helpers cannot pass release gates. It never launches those helpers, plays audio, imports the real host runtime or controls a desktop. Existing output directories are not overwritten. For a later independent pass, provide a fresh BuildPrefix.

For compile-only review:

~~~powershell
.\Build.ps1 -ReviewOnly -BuildName review-a
~~~

An operational build requires a separately approved user-supplied recording and rights declarations. See [ASSETS.md](ASSETS.md). A mock test pass does not establish those rights or prove real playback.

## Publication and licensing

Only [PUBLIC-FILES.json](PUBLIC-FILES.json) defines the approved public source scope. Build output, diagnostic evidence, audio, credentials, installation caches and private project history are excluded. The owner approved source-only publication under [MIT](LICENSE), with HolySong0817 attribution. [LICENSE-STATUS.md](LICENSE-STATUS.md) explains the scope and remaining external rights limits. This source publication does not authorize a binary release or a signing-service application.

Third-party prerequisites and unresolved rights are recorded in [LICENSE-INVENTORY.md](LICENSE-INVENTORY.md).

## Code signing policy

See [SIGNING-POLICY.md](SIGNING-POLICY.md). No sponsor or certificate has been approved. Free signing is discretionary and is not promised. The gate requires both helpers, a confirmed signer, trusted Windows Authenticode status, timestamps, successful all-signature verification and stable signed-file hashes; it also blocks missing audio approval or pending code licensing.

## Privacy and installation

See [PRIVACY.md](PRIVACY.md). This project has no direct network transfer. Its external host has separate terms and privacy practices. Build and review scripts do not install this plugin or alter system settings. Any future release must document installation and uninstallation for a specifically validated host version before deployment. Do not disable Windows protections to run a review build.
