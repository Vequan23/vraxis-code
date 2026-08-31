# Accessibility quality contract

Vraxis Code targets WCAG 2.1 AA for its core desktop journeys. Accessibility is a release behavior, not a one-time visual review.

## Automated coverage

The Playwright suite runs the official axe engine against:

- the first-run empty workspace;
- an active project and composer;
- Files, Changes, Terminal, Browser, and Verify evidence views;
- the complete Settings surface;
- open shadow roots rendered by osx Components.

The scan evaluates WCAG 2.0 and 2.1 A and AA rules, including accessible names, ARIA relationships and allowed attributes, landmarks, heading structure, contrast, form labels, and common keyboard semantics. Any reported violation fails the public browser workflow.

Existing browser journeys also cover unique IDs, native input names, keyboard tab switching, current-step semantics, closable file and diff panes, internal scrolling, narrow viewport overflow, and console errors.

## Manual release checks

Automated checks cannot prove a complete accessible experience. Before a stable release, test the packaged app with:

- VoiceOver on macOS and Narrator on Windows;
- keyboard-only project selection, task submission, approval, terminal interruption, browser control, change review, and Settings;
- 200 percent zoom and large system text where the platform supports it;
- reduced motion and increased contrast preferences;
- light and dark theme contrast after any token change;
- announcements for streaming agent output, approvals, failures, and completed verification.

Record failures against the owning layer. Product flow and information architecture belong in Vraxis Code. Reusable custom-element semantics, focus behavior, and visual tokens belong in `@vraxis/osx-components`.

## Limits

A clean axe result means no automatically detectable violations in the tested state. It does not certify WCAG conformance, screen-reader usability, understandable copy, or accessible behavior in untested third-party browser pages. Those require manual review with assistive technology and representative users.
