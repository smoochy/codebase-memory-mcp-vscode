<!-- managed centrally - do not edit manually -->
# Phase 3: Code Review

This phase runs after code has been written. Use the threat model from Phase 1 to focus the review — only check the sections of [SECURE-PATTERNS.md](SECURE-PATTERNS.md) that apply to what's being built.

## How to run the review

### Step 1: Re-anchor to the threat model

Before reading a single line of code, recall (or quickly re-derive) from Phase 1:

- What is this code supposed to do?
- Who can call it and with what trust?
- What's the worst outcome if it's wrong?
- Which threat categories were selected?

If Phase 1 was skipped (e.g., the user posted code and asked "is this safe?"), derive the threat model now from the code itself. It takes 30 seconds and prevents you from flagging irrelevant issues.

### Step 2: Read the code with attacker eyes

Go through the code path an attacker would take:

1. Where does input enter?
2. Does anything happen to it before reaching an interpreter (SQL, shell, filesystem, template)?
3. Are identity and permissions verified before each action, or assumed from an earlier check?
4. What does the code emit — HTML, JSON, files, emails? Is user-controlled content properly encoded?
5. Are there any secrets, credentials, or tokens visible in the code itself?

Read the full code path, not just the function that was changed. A secure function called from an insecure route is still exploitable.

### Step 3: Check the key invariants

For each threat category in scope, verify the invariants listed at the bottom of each SECURE-PATTERNS.md section. Invariants are binary: either they hold or they don't. This is faster than reading the whole pattern again.

Example invariant check for an endpoint that queries the database and renders HTML:
- [ ] SQL query uses placeholders, not string formatting
- [ ] Query includes current user's ID or tenant ID (no IDOR)
- [ ] Output encoded by auto-escaping template engine or `textContent`
- [ ] Error response is generic, no stack trace

### Step 4: Look for what the code does well

Note what's handled correctly, especially where it wasn't obvious. This serves two purposes: it builds trust that your findings are calibrated, and it helps the developer prioritize what to protect as the code evolves.

If auth is solid, say so. If parameterized queries are used consistently, call that out. Security reviews that only list failures are noise.

## Output format

Structure findings in three tiers. Be concise — one clear finding is worth more than five vague ones.

---

### CRITICAL
Issues that must be fixed before this code ships. Exploitable as-is, or provides a direct path to a serious outcome.

For each CRITICAL issue:
- **Where**: exact file and line number (or code snippet)
- **What**: what an attacker can do and what they get
- **Why the safer approach**: one plain sentence — what specifically goes wrong if this isn't fixed
- **Fix**: the specific change to make, with a corrected code snippet if helpful

---

### WARNING
Real issues that should be fixed soon, but may not block an immediate release depending on deployment context.

For each WARNING:
- **Where**: location
- **What**: the risk and under what conditions it's exploitable
- **Why the safer approach**: one plain sentence explaining the real-world consequence
- **Fix**: what to change

---

### NOTE
Hardening suggestions, minor inconsistencies, or patterns that are safe today but fragile. Not blocking.

For each NOTE:
- **Where**: location
- **What**: the concern
- **Why the safer approach**: one plain sentence — what future scenario this protects against
- **Suggestion**: what a more robust implementation would look like

---

### Looks Good
What the code gets right. Brief, specific, genuine.

---

## Calibration guidelines

**Don't inflate severity.** A theoretical injection in a field the user can't actually control is a NOTE, not a CRITICAL. A timing-unsafe comparison on a low-value token is a WARNING, not a CRITICAL. If you can't describe a concrete attacker action and outcome, the severity is lower than you think.

**Don't pad findings.** Three real WARNINGs are more useful than eight NOTEs that clutter the output. If the note is "this would be nice to have," consider omitting it unless the developer explicitly asked for hardening suggestions.

**Don't flag framework behavior.** If the framework auto-escapes templates, don't tell the developer to manually escape values. If the ORM uses parameterized queries by default, don't warn about SQL injection unless you found a raw query. Read the documentation before flagging.

**Consider the deployment context.** Rate limiting at the CDN level is a valid architecture — an endpoint without application-level rate limiting isn't automatically a finding if the CDN enforces it. Ask or check the deployment config before flagging.

**For ambiguous cases, ask.** If you're not sure whether a pattern is intentional (e.g., an endpoint that skips auth — is it a public endpoint?), ask rather than assume it's a bug.

## When the review finds no issues

Say so directly. "No security issues found in the scope of this review" is a valid and useful output. Specify what you looked at, so the developer knows the scope of the clean bill.

## When the review finds something CRITICAL

Flag it immediately — don't wait until the end of the review to surface a blocker. Tell the developer what to fix before anything else. Then continue the review for remaining issues.
