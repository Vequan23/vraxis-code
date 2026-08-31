# Releasing Vraxis Code

Vraxis Code publishes a macOS release only from an annotated or lightweight `vX.Y.Z` tag whose version matches `package.json`. The release workflow repeats the full local quality gate, all browser journeys, production dependency audit, packaged-app smoke test, signing, notarization, and artifact verification before it creates a public GitHub release.

## Required repository secrets

Configure these GitHub Actions secrets without placing them in source, package metadata, or desktop config:

- `MACOS_CERTIFICATE_P12_BASE64`: base64-encoded Apple Developer ID Application certificate and private key.
- `MACOS_CERTIFICATE_PASSWORD`: password for the PKCS#12 bundle.
- `APPLE_SIGNING_IDENTITY`: exact Developer ID Application identity used by `codesign`.
- `APPLE_ID`: Apple account used by the notarization service.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for that account.
- `APPLE_TEAM_ID`: Apple Developer team identifier.

The workflow imports the certificate into a temporary keychain, limits key access to `codesign`, and deletes the certificate and keychain on every outcome. Git checkout does not persist a repository credential.

## Release procedure

1. Confirm `main` is green and the changelog describes the release.
2. Set the root package version to the intended semantic version and commit it.
3. Create and push the matching tag, for example `v0.2.0`.
4. Watch **Release macOS**. It fails closed when credentials are missing, the tag differs from the package version, any quality gate fails, or the artifact is unsigned, unnotarized, missing, size-mismatched, or checksum-mismatched.
5. Inspect the generated GitHub release, disk image, and versioned JSON manifest.

The manifest contains the stable channel, exact GitHub asset URL, file size, architecture, and SHA-256 checksum. `scripts/verify-desktop-release.mjs` re-hashes the disk image and rejects an unsafe filename or any identity, channel, URL, tag, signing, notarization, size, or checksum mismatch before publication.

## Current boundary

This workflow provides signed distribution and verifiable release metadata for macOS. Vraxis Desktop does not yet consume that metadata for in-app update delivery, and Windows/Linux signing is not yet implemented. Vraxis Code must not claim automatic updates until those foundation capabilities ship and are tested end to end.
