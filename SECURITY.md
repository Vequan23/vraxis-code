# Security policy

Report suspected vulnerabilities through the repository's **Security → Report a vulnerability** flow. That creates a private GitHub Security Advisory visible only to the reporter and maintainers. If private vulnerability reporting is temporarily unavailable, open a public issue containing no exploit details or user data and ask the maintainers to establish a private channel.

Do not open a public issue with credentials, local paths, session content, proof-of-concept data, or reproduction steps that could affect another user. Include affected versions, impact, prerequisites, and a minimal safe reproduction in the private report. Maintainers will acknowledge a complete report within five business days and coordinate disclosure after a fix is available.

Vraxis Code treats the renderer as unprivileged. Project files, commands, runtime credentials, browser control, Git mutations, and local persistence belong to the loopback service or the Vraxis Desktop host.

Every API route that exposes user data or privileged action must require the desktop session, validate loopback host and origin values, and reject paths outside a registered project.

Only the latest release is supported with security fixes while Vraxis Code remains pre-1.0.
