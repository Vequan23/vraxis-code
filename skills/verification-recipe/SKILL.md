---
name: verification-recipe
description: Honor project-owned verification contracts, Project Doctor discovery, and browser proof in Vraxis Code.
metadata:
  version: "1.0.0"
---

# Verification recipe

Use this skill when planning or running verification inside Vraxis Code.

## Project contract

- Prefer `.vraxis/verify.json` when present. It pins checks, services, browser targets, assertions, and visual baselines.
- When no recipe exists, use Project Doctor discovery but explain that a recipe makes verification reproducible.
- Every check, service, and browser action still requires explicit product approval.

## Browser proof

- Capture proof from the configured browser URL. Do not substitute a different route or origin.
- If the current page is not the configured target, stop and report the mismatch. Do not keep browsing an external research URL.
- Route, title, visible-text, console, network, and visual assertions are evaluated from the same capture.
- Report failures with the failing check, command output, and any browser assertion that did not pass.

## Delivery

- Run only host-allowlisted commands and approved loopback origins.
- Retain terminal output and browser evidence in the task receipt.
- Do not weaken required checks to force a passing result.
