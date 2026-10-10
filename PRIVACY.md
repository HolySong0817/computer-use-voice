# Privacy scope

The source contains no HTTP client, analytics endpoint, account credential or direct network transfer. It reads local host runtime metadata and loads the installed host's module only in an approved operational integration. The host application and runtime have their own terms and privacy practices; they are not bundled or controlled by this project.

In an operational integration the pretool reads bounded hook input, hashes the session identifier for a local state filename and stores gate status/timing under the host's PLUGIN_DATA directory. It uses a local named mutex for coordination. It does not store raw session identifiers, screenshots, transcripts or desktop content in that state. The wrapper may return runtime identity and timing to the caller; a caller-provided diagnostic sink determines how its own results are retained.

Build/review evidence contains relative filenames, hashes, tool versions and pass/block status. Review scripts do not play audio, import the real runtime, execute a helper or operate a desktop. The project does not change Windows protections or install a trust root. There is no remote CI credential in the proposed public tree.

No installation is performed by this candidate. A future host-specific installation must disclose local state writes and provide the validated host's removal instructions before deployment.
