---
name: create-skill
description: Scaffold and author Agent Skills with SKILL.md for Vraxis Code, Cursor, Codex, and other harnesses. Use when creating a new skill or asking about skill structure.
metadata:
  version: "1.0.0"
---

# Create skill

Use this skill when the user runs `/create-skill` or asks to author a reusable agent skill.

## Gather requirements first

Before writing files, confirm:

1. **Purpose**: What workflow should the skill teach?
2. **Scope**: Project (`.agents/skills/`) or user-global (`~/.agents/skills/`)?
3. **Triggers**: When should the agent apply it? Put triggers in the description.
4. **Output shape**: Templates, checklists, examples, or scripts?
5. **Verbatim copy**: If the user supplied exact wording, keep it verbatim in `SKILL.md`.

If the user already gave enough detail, proceed without re-asking everything.

## Storage locations

| Scope | Path | Shared with |
|-------|------|-------------|
| Project | `.agents/skills/<skill-name>/SKILL.md` | Everyone using the repository |
| User | `~/.agents/skills/<skill-name>/SKILL.md` | All projects on this device |

Harnesses also read `.cursor/skills/` and related directories after install. Prefer `.agents/skills/` for new Vraxis skills.

Never write skills into harness-internal directories such as `~/.cursor/skills-cursor/`.

## Directory layout

```
skill-name/
├── SKILL.md          # Required
├── reference.md      # Optional deep docs
├── examples.md       # Optional examples
└── scripts/          # Optional utilities
```

## SKILL.md format

```markdown
---
name: your-skill-name
description: What the skill does and when to use it. Write in third person with trigger terms.
metadata:
  version: "1.0.0"
---

# Skill title

## Instructions
Step-by-step guidance.

## Examples
Concrete usage examples.
```

### Name rules

- Lowercase letters, numbers, and hyphens only
- Start with a letter
- Max 48 characters

### Description rules

- Non-empty, max 1024 characters
- Third person ("Processes Excel files…", not "I can help…")
- Include both **what** it does and **when** to use it

## Authoring principles

- Keep `SKILL.md` concise. The agent already knows general software practice.
- Put long reference material in sibling files and link once from `SKILL.md`.
- Prefer progressive disclosure over one huge manifest.
- Metadata values must be strings. Use `"1.0.0"` not bare numbers.

## Scaffold workflow

When the user wants a new skill file created:

1. Pick `skill-name` from the purpose (e.g. `api-review`, `commit-helper`).
2. Write frontmatter with a strong description.
3. Create `.agents/skills/<skill-name>/SKILL.md` in the **approved project root**, not the Build worktree, unless the user explicitly wants an experimental project-local draft.
4. Add instructions and at least one example or template when helpful.
5. Tell the user to attach it with `$<skill-name>` or refresh Settings → Skills library.

When Vraxis exposes **Prepare create** in Settings, prefer that for empty scaffolds and then expand the generated file.

## Validation checklist

- [ ] `name` matches the directory name
- [ ] Description includes trigger scenarios
- [ ] Body gives actionable steps, not generic advice
- [ ] Metadata values are strings
- [ ] File lives under an approved skill directory
