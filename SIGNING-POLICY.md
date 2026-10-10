# Code signing policy — pending service approval

No SignPath subscription, certificate or sponsored signing has been approved for this project. No request has been submitted. Do not display a sponsor acknowledgement as if it were already provided.

The [SignPath Foundation conditions](https://signpath.org/terms.html) and [application page](https://signpath.org/apply.html) were checked on 2026-10-10. Free service is discretionary.

| Eligibility item | Current evidence / gap |
| --- | --- |
| OSI license for components | Reviewed source is MIT; audio excluded and external prerequisites retain their own terms. |
| Source ownership | Owner confirms authority to publish/license; no independent historical copyright audit claimed. |
| Maintained public project and documented release | Source-only edition; no operational release or sustained-maintenance record established. |
| Verifiable reputation | No existing public release/history evidence; do not invent it. |
| Repository control, MFA and signing roles | Not configured or verified; names and permissions need owner approval. |
| Public signing/privacy/uninstall documentation | Drafts only; host deployment is unvalidated. |
| Product metadata and traceable build | Local deterministic source builds and fixed shared product/version metadata; remote provenance pipeline absent. |
| Manual signing approval | No approver or approved workflow yet. |
| External proprietary-host boundary | Requires Foundation review; host/SDK not included. |

Foundation acceptance and signing are not guaranteed. Source publication is approved; no signing-service application or binary release is approved. Actual signing requires a separate decision, required evidence and service approval. Stop if any payment, card, trial subscription or paid plan is requested.

Locally, Seal-Release.ps1 verifies both already-signed helpers against the approved signer, Windows trust and timestamp evidence using a valid Microsoft SignTool with all-signature verification. It rejects missing assets, pending owner/license approval, missing helpers, untrusted signatures or changed bytes. It never imports a certificate, signs, uploads, installs or runs a helper. Signed file hashes and the complete locked package inventory are recorded before local packaging.

Even successful signature validation does not imply current host compatibility or Smart App Control acceptance. Those require separately approved integration tests. No security exclusions or protection changes are part of the project.
