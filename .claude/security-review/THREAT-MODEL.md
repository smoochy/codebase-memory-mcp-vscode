<!-- managed centrally - do not edit manually -->
# Phase 1: Understand What's Being Built

Before writing or reviewing any code, build a threat model. This doesn't need to be a formal document — it's a mental map you use to decide which patterns from [SECURE-PATTERNS.md](SECURE-PATTERNS.md) apply and how much attention each deserves.

## Persistent threat model

If `threat-model.md` exists in the project root, load it instead of building from scratch. This file accumulates threat models per feature and is updated incrementally — only stale sections are re-derived.

### On every run

1. Check whether `threat-model.md` exists in the project root.
2. If it exists:
   a. Identify which feature section matches what's being worked on now.
   b. Read that section's `_depends:` list — the files its security posture depends on.
   c. Compute a combined checksum of only those files:
      ```bash
      cat <file1> <file2> ... | shasum | cut -c1-8
      ```
   d. Compare against the stored `_checksum:` value in that section.
   e. If they match → load the section as-is. No re-derive, no token cost.
   f. If they differ → re-derive only this section using the five questions below, then update `_checksum:` and `_last_updated:`.
3. If `threat-model.md` does not exist → run the five questions in full, then write the file with the new section.

**Only checksum the dependencies of the current feature.** Changes to unrelated modules are invisible to this run — even if those modules changed, they are not re-derived unless the current feature's `_depends:` list includes them.

### File format

Each feature is a `##` section with metadata fields, followed by the five-question output:

```markdown
## Feature: <name>

_last_updated: YYYY-MM-DD_
_depends: [path/to/file1.py, path/to/file2.py]_
_checksum: <8-char shasum>_

### Summary
One sentence.

### Input surfaces
- ...

### Output/touch surfaces
- ...

### Actor trust level
...

### Worst-case outcome
...

### Data sensitivity
[classification: Public / Internal / PII / Sensitive PII / Credentials / Payment]

### Trust assumptions
[list what this code assumes is already safe, and whether each is enforced or delegated]

### Threat categories
[comma-separated list of relevant SECURE-PATTERNS.md sections]
```

### What to list in `_depends:`

List every file whose change would meaningfully alter this feature's security posture:
- The handler/controller file
- Auth middleware it passes through
- Database models or schema files it queries
- Any shared utility it calls (validation, encryption, session)

Do not list files that are purely internal to another feature and have no call path into this one.

### After writing or updating a section

Always recompute and persist the checksum:
```bash
cat <depends files> | shasum | cut -c1-8
```

Write the updated `threat-model.md` back to the project root.

---

## Five questions to answer

Work these out from the user's description, the existing codebase, and any clarifying questions. You usually don't need to ask all five explicitly — read the context.

### 1. What does this feature do?

One sentence. If you can't say it in one sentence, ask the user to clarify before going further. Ambiguity here causes misapplied security guidance later.

Examples:
- "Upload a profile photo and store it in S3"
- "Authenticate a user with email and password, issue a session token"
- "Accept a webhook from Stripe, update the user's subscription status"
- "Query the database for items the current user owns"

### 2. What inputs does it take?

List every input surface. These are the attacker's entry points.

- **HTTP parameters**: query strings, path segments, request bodies (JSON, form data, multipart)
- **Uploaded files**: what types are expected, what's the max size
- **Headers**: Authorization, Cookie, Content-Type, custom headers
- **External API responses**: third-party data you fetch and process
- **Environment / config**: env vars, config files loaded at runtime
- **User-controlled data stored earlier**: database values written by users and later read back

### 3. What does it output or touch?

List every system the feature reads from or writes to. These are where damage lands if something goes wrong.

- **Database**: reads, writes, which tables, which columns
- **Filesystem**: reads, writes, what paths
- **External services**: outbound HTTP calls, email, SMS, S3, queues
- **Rendered output**: HTML, JSON, emails, PDFs — anything that reaches a browser or client
- **Shell**: any subprocess execution
- **Other users' data**: can this feature affect records belonging to someone else?

### 4. Who are the actors?

Identify who can trigger this feature and what trust level they have.

- **Anonymous / unauthenticated**: anyone on the internet
- **Authenticated user**: a logged-in account, but not privileged
- **Privileged user / admin**: elevated role, but still a human who can be compromised
- **Service account / internal service**: machine-to-machine, usually on a private network
- **The developer / operator**: deploying or maintaining the system

If the feature is reachable by anonymous users, the security bar is highest. If only internal services can call it, the bar is lower — but not zero (SSRF, supply chain).

### 5. What's the worst outcome if this goes wrong?

This sets severity calibration for the whole review.

- **Remote code execution**: attacker runs arbitrary commands on the server
- **Data breach**: attacker reads data they shouldn't
- **Account takeover**: attacker gains control of another user's account
- **Privilege escalation**: attacker gains capabilities above their role
- **Data corruption / destruction**: attacker modifies or deletes data
- **Denial of service**: attacker degrades availability
- **Information disclosure**: attacker learns something they shouldn't (credentials, PII, internals)

### 6. What data does this handle, and how sensitive is it?

This determines encryption requirements, logging constraints, and how seriously to treat any data exposure — a breach of public usernames and a breach of social security numbers are not the same threat.

Classify the data this feature touches:

- **Public / non-sensitive**: data that is already exposed or has no personal value (public product listings, public blog posts)
- **Internal / low-sensitivity**: data that should stay internal but isn't personally identifying (internal config, aggregate stats)
- **Personal data (PII)**: names, emails, addresses, phone numbers, IP addresses, anything that identifies a person
- **Sensitive PII**: government IDs, health information, financial records, biometrics — regulated in most jurisdictions
- **Credentials / secrets**: passwords, API keys, tokens, private keys — exposure means immediate compromise
- **Payment data**: card numbers, bank details — subject to PCI-DSS; never store raw

For each data type present, ask:
- Is it encrypted at rest and in transit?
- Could it appear in logs, error messages, or debug output?
- Are there regulatory requirements (GDPR, HIPAA, PCI) that apply?
- Who inside the company should and shouldn't be able to see it?

### 7. What does this code trust that it doesn't verify itself?

List every security assumption this feature makes about the world around it — things it counts on being true but doesn't check directly.

Common assumptions that turn into bugs:

- **"Auth middleware already checked the user is logged in"** — but is this route actually registered behind that middleware? Could anything call this function directly?
- **"The input was validated before reaching this function"** — but is there only one call site, and will that always be true?
- **"This endpoint is only reachable by internal services"** — but is it actually network-restricted, or just assumed to be?
- **"The file path was sanitized upstream"** — but by what, and does every code path that reaches here go through it?

For each assumption found, ask:
- Is it enforced in code, or just expected by convention?
- Could this function be called from a new place that skips the assumed check?
- What happens if the assumption is violated — is there a fallback, or does it fail silently?

If an assumption is not enforced at the boundary of this feature, either add the check here or document explicitly why the delegation is safe.

## Selecting threat categories

Once you've answered the five questions, map to the relevant sections of [SECURE-PATTERNS.md](SECURE-PATTERNS.md):

| What you're building | Relevant sections |
|---|---|
| Endpoint that accepts user input | Input Validation & Injection, Error Handling |
| Login / registration / password reset | Authentication, Session Management |
| Role-based access or resource ownership checks | Authorization & Access Control |
| File upload or download | File Handling |
| Generating HTML or rendering user content | Output Encoding |
| Storing or comparing passwords | Cryptography & Secrets |
| Calling an external URL supplied by the user | SSRF & Outbound Requests |
| Using an API key, token, or credential | Cryptography & Secrets |
| Writing an API others will call | API Security |
| Installing or importing a package | Dependency Security |

Select only the sections that apply. Do not surface a pattern if it's irrelevant to the feature — that's noise.

## Output of Phase 1

Before moving to Phase 2 (Guide) or Phase 3 (Review), have a written answer to:

- **Feature summary**: one sentence
- **Input surfaces**: bulleted list
- **Output/touch surfaces**: bulleted list
- **Actor trust level**: who triggers this
- **Worst-case outcome**: the single most damaging thing that could go wrong
- **Threat categories selected**: which sections of SECURE-PATTERNS.md apply

Write this output into `threat-model.md` as a new `##` section (or update the existing one if the feature already has an entry). Compute and store the `_checksum:` and `_depends:` fields before moving on.

For a quick review ("is this function safe?"), you can compress the five questions to a mental check — but still update the checksum if the relevant section already exists in `threat-model.md`, so the next run knows whether to re-derive.
