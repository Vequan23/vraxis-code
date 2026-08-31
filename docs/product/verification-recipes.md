# Project-owned verification recipes

Vraxis Code discovers conventional checks automatically. A repository can make its delivery contract explicit by adding `.vraxis/verify.json`:

```json
{
  "$schema": "../../docs/schemas/verify.schema.json",
  "schemaVersion": 1,
  "services": [
    {
      "id": "web:preview",
      "title": "Preview server",
      "command": "npm",
      "args": ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4318"],
      "cwd": ".",
      "health": {
        "url": "http://127.0.0.1:4318/",
        "expectedStatus": 200,
        "timeoutMs": 60000,
        "intervalMs": 250
      }
    }
  ],
  "checks": [
    {
      "id": "web:check",
      "title": "Web quality gate",
      "category": "check",
      "command": "npm",
      "args": ["run", "check", "--workspace", "@example/web"],
      "cwd": ".",
      "required": true,
      "timeoutMs": 900000
    }
  ],
  "browser": {
    "required": true,
    "url": "http://127.0.0.1:4318/",
    "assertions": [
      { "id": "route", "title": "Landing route", "kind": "url", "value": "http://127.0.0.1:4318/" },
      { "id": "title", "title": "Product title", "kind": "title", "match": "contains", "value": "Example" },
      { "id": "ready", "title": "Ready state", "kind": "text", "match": "contains", "value": "Ready to ship" }
    ],
    "visual": {
      "baseline": "test-baselines/home.png",
      "maxDiffRatio": 0.01
    }
  }
}
```

The file is a declaration, not ambient authority. Inspection never executes project code. Every service and check becomes a separate approval request, uses an executable plus an argument vector rather than a shell expression, runs inside the approved project or isolated Build worktree, and retains its output in the task receipt.

Declared services are started as governed terminal processes. Vraxis waits for their loopback health checks before running dependent checks and always attempts teardown after pass, failure, denial, interruption, or restart. Health requests do not follow redirects and never accept embedded credentials.

Browser proof must come from the exact configured URL. URL, title, and visible-text assertions are evaluated against the same captured browser state used for console and network evidence. A visual comparison uses the captured frame and a project-owned PNG baseline. It records dimensions, changed pixels, and the observed ratio; a bounded PNG diff is retained only when the allowed tolerance is exceeded.

Recipes are intentionally bounded:

- 1–20 checks, up to eight services, and up to 20 browser assertions.
- A 64 KB recipe file limit and a 10 MB, 16 megapixel limit for baseline and captured PNG files.
- Project-relative working directories and baseline paths; symlinks cannot move them outside the approved project or worktree.
- A 30-minute maximum per process and explicit service health deadlines.
- HTTP only for loopback browser and health targets; remote browser targets require HTTPS.
- Exact URL equality for route assertions. Text and title assertions may use `equals` or `contains` and explicit case sensitivity.

A normalized SHA-256 fingerprint binds services, checks, assertions, visual tolerance, and browser target into a reproducible recipe. Reruns use fresh approvals and receipts while retaining lineage. Project recipes replace auto-discovered commands for that project; deleting the file returns to manifest discovery.

Use the checked-in [JSON Schema](../schemas/verify.schema.json) for editor validation.
