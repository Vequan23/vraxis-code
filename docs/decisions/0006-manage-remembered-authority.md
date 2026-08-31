# 0006: Manage remembered authority as a first-class product surface

Status: accepted

## Context

Remembering an exact task or project decision reduces approval fatigue, but durable authority becomes unsafe when it is visible only while another action is waiting. Users need one device-level view that answers what can run without asking, where it applies, when it was granted, and how to remove it.

## Decision

Settings contains an **Access & approvals** center that lists every active task- and project-scoped rule across registered projects. Each row leads with allow or deny, capability, source, exact redacted scope, project, duration, and creation date. Revocation is immediate because it removes authority and changes no project data; the next matching action asks again.

The service exposes active rules separately from a versioned `vraxis.approval-policy-audit@1` export. The audit includes active and revoked rules plus allow/deny counts so security review can retain policy history. It contains no raw tool input. Approval scopes remove URL credentials, query strings, fragments, known credential formats, bearer tokens, and common secret assignments before they are persisted or exported.

Pending approval cards remain in the task because those decisions need immediate attention. Durable policy management does not compete with the current task and does not use a modal.

## Consequences

- A user can discover and revoke remembered authority even when no request is pending.
- Enterprise reviewers can export a portable local policy record without exposing the product's private storage.
- Revoked rules remain audit evidence but never match a future request.
- Editing a rule's scope or effect is deliberately not implicit. Revoke it and approve the new exact action so the resulting authority has a fresh receipt.
