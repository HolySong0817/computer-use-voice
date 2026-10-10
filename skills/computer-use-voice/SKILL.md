---
name: computer-use-voice
description: Self-made third-party fixed voice warning gate for the supported Windows Node REPL Computer Use integration. Not an official OpenAI product.
---

# Computer Use Voice

This review candidate has no warning WAV and no trusted signing identity. Do not install or execute its compiled helpers. Installation and current-host compatibility remain unvalidated.

For a separately approved operational release, the fixed warning must say exactly: 注意，Codex 即將接管电脑。

The synchronous PreToolUse hook applies only to mcp__node_repl__js. It waits for the notifier's ordered audio_playback_started and audio_playback_finished events and a gate of at least 2000 ms before allowing supported controls. Helper failure, timeout, invalid asset pins, invalid protocol, runtime ambiguity, or API mismatch must deny control.

Use the injected installGlobalSkyWarningGate({ globals: globalThis }) path. Do not retain a raw runtime reference to bypass the wrapper. Discover the host-provided runtime from its package metadata and real path; do not hard-code a runtime version or installation identifier.

Supported control methods: launch_app, activate_window, click, type_text, press_key, scroll, drag, set_value, perform_secondary_action. Observation methods get_window, get_window_state, list_apps, list_windows stay silent.

Keep normal host permissions and user approvals. This warning does not grant permission to control a desktop. Do not alter Smart App Control, Defender, execution policy, certificate trust, official application files, or installed plugin caches. Fail closed rather than retrying through an unprotected path.

The host runtime and SDK are external prerequisites and are not distributed by this project. The current tool provider may use a different API, and actual host compatibility must be tested separately.
