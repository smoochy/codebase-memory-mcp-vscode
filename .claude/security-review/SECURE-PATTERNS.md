<!-- managed centrally - do not edit manually -->
# Secure Patterns

Reference patterns organized by threat category. Read the relevant sections based on the threat model from Phase 1. Each section follows the same structure: the threat, what to avoid, what to do instead, and the key invariants to preserve.

---

## 1. Input Validation & Injection

### The threat
User-controlled data reaches an interpreter (SQL engine, shell, template renderer, XML parser, eval) without being properly separated from code. The attacker encodes commands inside data.

### What to avoid

```
# SQL injection
query = f"SELECT * FROM users WHERE email = '{email}'"

# Shell injection
subprocess.run(f"convert {filename} output.png", shell=True)

# Path traversal via string concat
path = os.path.join(BASE_DIR, user_supplied_path)  # still dangerous if user_supplied_path starts with /

# Template injection
template.render(user_input)  # if user_input contains {{ }} expressions
```

### What to do instead

**Parameterize, don't concatenate.** For every interpreter, use the mechanism designed to separate code from data:

- SQL: parameterized queries / prepared statements — never string-format into a query
- Shell: pass arguments as a list, never `shell=True` with user data; prefer not shelling out at all
- Filesystem: resolve the final path and verify it starts with your expected base directory
- Templates: use auto-escaping engines; never `eval` or `render` user-controlled template strings
- XML/HTML: use a parser, never regex or string replacement on structured markup

**Allowlist over blocklist.** Validate that input matches an expected format (UUID, integer, enum value, email pattern) rather than trying to strip bad characters. Stripping is lossy and often bypassable.

**Validate at the boundary.** Validate the moment input enters your system — at the controller/handler layer, before it reaches business logic or persistence. Don't rely on downstream code to remember.

### Key invariants
- Every SQL query uses placeholders. Zero exceptions, including dynamic `ORDER BY`, `LIMIT`, table/column names.
- `shell=True` never appears with user-controlled input.
- Filesystem paths are resolved and prefix-checked before any read/write.

---

## 2. Authentication

### The threat
Weak credential handling, bypassable login flows, and missing verification allow attackers to authenticate as other users or skip authentication entirely.

### What to avoid

```
# Comparing tokens with ==  (timing attack)
if request.token == stored_token:

# Rolling your own password hashing
password_hash = sha256(password).hexdigest()

# Trusting client-supplied identity
user_id = request.json["user_id"]  # attacker controls this

# Weak reset token
reset_token = str(random.randint(100000, 999999))

# JWT without algorithm check
jwt.decode(token, key)  # accepts 'alg: none'
```

### What to do instead

**Use constant-time comparison for secrets.** Use `hmac.compare_digest()` (Python), `crypto.timingSafeEqual()` (Node.js), or your framework's equivalent. Never `==` for tokens, hashes, or signatures.

**Hash passwords with a slow algorithm.** bcrypt, scrypt, or Argon2. Never SHA-256, MD5, or plain storage. Use a well-maintained library that handles salting automatically.

**Derive identity from the session, not the request.** The authenticated user's ID comes from your validated session/token, not from a parameter the client sends. Never trust `user_id` in a request body.

**Generate cryptographically random tokens.** Use `secrets.token_urlsafe()` (Python), `crypto.randomBytes()` (Node.js), or your language's CSPRNG. Never `Math.random()`, `random.randint()`, or timestamp-based tokens.

**Validate JWT algorithm explicitly.** Specify allowed algorithms when verifying. Never accept `alg: none`. Prefer asymmetric keys (RS256) for tokens verified across services.

**Enforce rate limiting on auth endpoints.** Brute force is the simplest attack on login. Apply per-IP and per-account rate limits on login, password reset, and OTP endpoints. Exponential backoff or lockout after N failures.

**Multi-factor when the stakes are high.** If the feature unlocks sensitive data or irreversible actions, design MFA in from the start — retrofitting it is painful.

### Key invariants
- No `==` comparison of secrets, tokens, or hashes.
- Passwords hashed with bcrypt/scrypt/Argon2.
- Session identity is derived server-side, never from client input.
- Reset and verification tokens are CSPRNG-generated with short expiry.

---

## 3. Authorization & Access Control

### The threat
Authenticated users can access or modify resources belonging to other users, or perform actions above their privilege level, because ownership and permissions are not checked at the point of action.

### What to avoid

```
# IDOR — fetching by ID without ownership check
def get_document(doc_id):
    return db.query("SELECT * FROM documents WHERE id = ?", doc_id)

# Role check missing
def delete_user(target_id):
    db.query("DELETE FROM users WHERE id = ?", target_id)

# Client-supplied role
user_role = request.json.get("role", "user")

# Checking permission before loading, but not before acting
if not user.can_read(doc_id):
    return 403
doc = db.get(doc_id)
doc.update(...)   # no check before mutating
```

### What to do instead

**Always scope queries to the authenticated user.** When fetching a resource, include the owner/tenant ID in the query itself — don't fetch then filter. If the row doesn't exist for that user, return 404 (not 403 — don't confirm the resource exists to unauthorized users).

```
# Safe: ownership enforced in the query
db.query("SELECT * FROM documents WHERE id = ? AND owner_id = ?", doc_id, current_user.id)
```

**Check permissions at the point of action, not just at read time.** Read access ≠ write access. Check the right permission for the right operation.

**Derive roles and permissions from the server-side session.** Never accept role claims from the client. Lookup roles from your database or auth token that was issued and signed server-side.

**Deny by default.** New endpoints should require explicit permission grants. The absence of a permission check is not an implicit allow.

**Prefer ABAC for complex scenarios.** If your permission model goes beyond simple role → resource ownership, use attribute-based access control (ABAC) patterns where the policy is explicit and testable.

**Log authorization failures.** A flood of 403s on a specific resource is an attack signal. Log the actor, resource, and action.

### Key invariants
- Every data-access query includes the current user's ID or tenant ID.
- Mutations check permissions independently of reads.
- No role, permission, or capability comes from client-supplied input.
- Default posture is deny.

---

## 4. File Handling

### The threat
Uploaded files can be malicious content, path traversal payloads, or oversized inputs. Serving user-uploaded content from the same origin as the application enables stored XSS and content-type confusion attacks.

### What to avoid

```
# Trusting the client-supplied filename
filename = request.files["upload"].filename
save_path = os.path.join(UPLOAD_DIR, filename)  # ../../etc/passwd

# Trusting the client-supplied Content-Type
content_type = request.headers["Content-Type"]

# Serving uploads from the app origin
# example.com/uploads/user-file.html  →  runs as trusted JS

# No size limit
file.save(destination)
```

### What to do instead

**Generate server-side filenames.** Never use the client-supplied filename for storage. Generate a UUID or hash-based name. Store the original filename separately in a database field if needed for display.

**Validate file type by content, not extension or MIME header.** Read magic bytes (file signatures). Use a library like `python-magic`, `file-type` (Node.js), or equivalent. The client controls both the filename and Content-Type header.

**Enforce size limits before processing.** Reject files over your limit early, before reading the whole stream into memory. Set limits at the web server/proxy layer as well.

**Serve uploads from a separate origin or dedicated storage.** Never serve user-uploaded files from the same origin as your application. Use S3, GCS, or a CDN subdomain. Set `Content-Disposition: attachment` on downloads to prevent browsers from executing them. Set `X-Content-Type-Options: nosniff`.

**Scan for malicious content if the stakes are high.** For document uploads, images, or anything that will be processed (resized, converted, parsed), consider virus scanning and processing in an isolated environment.

**Restrict upload directories tightly.** If you must write to disk, ensure the upload directory has no execute permissions and is not web-accessible.

### Key invariants
- Client-supplied filenames are never used directly for storage paths.
- File type validated by magic bytes, not extension or Content-Type header.
- Uploads served from a separate origin or with `Content-Disposition: attachment`.
- Size limits enforced before processing.

---

## 5. Output Encoding

### The threat
User-controlled data is included in HTML, JavaScript, JSON, or other output without encoding, allowing injected content to execute as code in the victim's browser.

### What to avoid

```
# Direct interpolation into HTML (XSS)
return f"<p>Welcome, {username}!</p>"

# Setting innerHTML with user data
element.innerHTML = userData;

# Serving user content as text/html
response.headers["Content-Type"] = "text/html"
return user_supplied_content

# Reflecting input without encoding
return jsonify({"error": f"Invalid value: {request.args['q']}"})
# even in JSON, if this is rendered into HTML later
```

### What to do instead

**Use a templating engine with auto-escaping enabled.** Jinja2, Handlebars, React JSX — all encode by default. The opt-out (`| safe`, `dangerouslySetInnerHTML`, `{{{}}}`), not the opt-in, should require explicit justification.

**Never set `innerHTML` with user data.** Use `textContent` for text. If you need to render user-provided HTML (e.g., a rich text editor), parse it through a strict allowlist sanitizer (DOMPurify). Never roll your own sanitizer.

**Set the correct `Content-Type` on every response.** JSON responses must be `application/json`. HTML must be `text/html`. Serving JSON as `text/html` causes the browser to parse it as HTML.

**Set `X-Content-Type-Options: nosniff`.** Prevents browsers from MIME-sniffing a response away from its declared content type.

**Encode for the right context.** HTML encoding, URL encoding, JavaScript encoding, and CSS encoding are different. A value safe in HTML body context may still be dangerous in an HTML attribute, a JavaScript string, or a URL parameter.

### Key invariants
- Template engines have auto-escaping on. Opt-outs require explicit review.
- `innerHTML` never receives user-controlled data.
- Every response has an explicit `Content-Type`.
- No unencoded user data in HTML attributes, script blocks, or URL contexts.

---

## 6. Cryptography & Secrets

### The threat
Weak algorithms, hardcoded secrets, secrets in source code or logs, and broken key management expose credentials and encrypted data.

### What to avoid

```
# Hardcoded secret
API_KEY = "sk-prod-abc123xyz"

# Weak algorithm
hashlib.md5(password).hexdigest()

# Secret in logs
logger.info(f"Processing payment for user {user_id} with token {token}")

# Secret in environment variable logged at startup
print(os.environ)

# Using encryption without authentication (CBC without MAC)
cipher = AES.new(key, AES.MODE_CBC, iv)
```

### What to do instead

**Store secrets in environment variables or a secrets manager.** Never commit secrets to source control. Use `.env` files that are `.gitignore`d, or use a secrets manager (AWS Secrets Manager, Vault, Doppler). Treat secrets as infrastructure, not code.

**Use authenticated encryption.** For symmetric encryption, use AES-GCM or ChaCha20-Poly1305 — these provide both confidentiality and integrity. Never use raw AES-CBC or AES-ECB without a separate MAC.

**Use the right tool for the right job.** Hashing passwords: bcrypt/scrypt/Argon2. Hashing data for integrity: SHA-256 or SHA-3. MACs: HMAC-SHA256. Token signing: HMAC or RSA. Symmetric encryption: AES-GCM. Asymmetric: RSA-OAEP or ECDH. Never use MD5 or SHA-1 for security purposes.

**Rotate secrets without downtime.** Design secret-using systems to accept two valid secrets simultaneously during rotation. Hard-wiring a single secret makes rotation an incident.

**Scrub secrets from logs.** Use log filtering middleware that redacts known-secret fields (Authorization header, Cookie, token, password, key, secret). Never log full request/response bodies in production.

**Scan for secrets before committing.** Use a pre-commit hook with a tool like `gitleaks` or `trufflehog`. Secrets that reach git history are compromised even if the commit is reverted.

### Key invariants
- Zero hardcoded secrets in source code.
- Encryption uses authenticated modes (AES-GCM, ChaCha20-Poly1305).
- Passwords hashed with a slow KDF, never with a general-purpose hash.
- Secrets excluded from all log output.

---

## 7. API Security

### The threat
APIs without proper access controls, rate limits, or security headers are vulnerable to abuse, scraping, brute force, and cross-origin attacks.

### What to avoid

```
# No rate limiting on sensitive endpoints
@app.route("/login", methods=["POST"])
def login():
    ...

# CORS wildcard on an authenticated API
response.headers["Access-Control-Allow-Origin"] = "*"

# No CSRF protection on state-changing endpoints

# Verbose error responses in production
return jsonify({"error": str(exception), "stack": traceback.format_exc()})

# Unauthenticated health endpoint leaking internals
@app.route("/health")
def health():
    return jsonify({"db_host": DB_HOST, "version": VERSION, "env": os.environ})
```

### What to do instead

**Rate limit every endpoint, especially auth-related ones.** Apply limits per IP and per account. Use a token bucket or sliding window approach. Return `429 Too Many Requests` with a `Retry-After` header.

**Configure CORS precisely.** Only allow origins that actually need access. If your API is consumed by your own frontend, list that specific origin. The wildcard `*` is only appropriate for fully public, unauthenticated APIs.

**Protect state-changing endpoints against CSRF.** For cookie-authenticated apps, use CSRF tokens (double-submit cookie pattern, or synchronizer token). For token-authenticated APIs (Bearer in Authorization header), CSRF is not a concern — but verify the `Content-Type` is `application/json` to prevent form-based CSRF fallbacks.

**Set security headers.** At minimum: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or `SAMEORIGIN`), `Strict-Transport-Security` (HSTS) with a reasonable max-age, `Content-Security-Policy`.

**Return generic error messages in production.** Never expose stack traces, database errors, internal paths, or environment details to external callers. Log the full error server-side; return only a generic message and a correlation ID.

**Sanitize health and debug endpoints.** Health endpoints should return minimal information (status: ok/degraded). Version, environment, and configuration data should require authentication or be absent entirely.

### Key invariants
- Rate limits on all auth endpoints.
- CORS origin is an allowlist, never `*` on authenticated APIs.
- Security headers set on all responses.
- Stack traces and internal errors never reach the client.

---

## 8. Session Management

### The threat
Weak, predictable, or poorly-managed session tokens allow attackers to hijack authenticated sessions.

### What to avoid

```
# Predictable session ID
session_id = f"{user_id}-{int(time.time())}"

# Long-lived tokens with no expiry
token = generate_token(expires=None)

# Session not invalidated on logout
def logout():
    response.delete_cookie("session")  # client-side only, server still accepts old token

# Storing sensitive data in a JWT without encryption
payload = {"user_id": 1, "ssn": "123-45-6789", "credit_card": "..."}
jwt.encode(payload, secret, algorithm="HS256")
```

### What to do instead

**Generate session IDs with a CSPRNG.** 128+ bits of entropy. Never derived from user attributes or timestamps.

**Set appropriate cookie attributes.** `HttpOnly` (prevents JS access), `Secure` (HTTPS only), `SameSite=Strict` or `Lax` (CSRF mitigation), scoped `Path` and `Domain`.

**Expire sessions server-side.** Absolute expiry (token is invalid after N hours regardless of activity) and idle expiry (token is invalid if unused for N minutes). Both enforced server-side — client-side expiry alone is not sufficient.

**Invalidate on logout, password change, and privilege change.** When a user logs out, changes their password, or their role changes, immediately invalidate all existing sessions. Store sessions in a server-side store (Redis, database), not just in a stateless JWT, if you need revocation.

**Rotate session ID after login.** Issue a new session ID immediately after successful authentication to prevent session fixation attacks.

**Don't store sensitive data in JWTs.** JWTs are base64-encoded, not encrypted by default. Anyone with the token can decode the payload. Store only non-sensitive identifiers (user ID, role) in JWT claims.

### Key invariants
- Session tokens are CSPRNG-generated with 128+ bits of entropy.
- Cookies have `HttpOnly`, `Secure`, and `SameSite` set.
- Sessions expire server-side and are invalidated on logout.
- No sensitive data in JWT payloads unless using JWE (encrypted JWT).

---

## 9. SSRF & Outbound Requests

### The threat
The application makes HTTP requests to a URL supplied or influenced by the user, allowing attackers to probe internal services, access cloud metadata endpoints, or reach otherwise-unreachable systems.

### What to avoid

```
# URL entirely from user input
def fetch_preview(url):
    return requests.get(url).text

# Partial URL from user input
host = request.args["host"]
requests.get(f"https://{host}/api/data")

# No timeout
requests.get(external_url)

# Following redirects blindly
requests.get(url, allow_redirects=True)
```

### What to do instead

**Validate URLs against an allowlist of known-safe hosts/domains.** If the set of valid destinations is known, enumerate them. Never let the user supply an arbitrary URL that the server will fetch.

**If arbitrary URLs are required (e.g., webhook delivery, link previews):**
- Resolve the DNS before connecting and block private IP ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local / cloud metadata), `::1`, `fc00::/7`
- Block the cloud metadata endpoint: `169.254.169.254`
- Disable redirects or re-validate the redirect target against the same rules
- Use a dedicated egress proxy with its own allowlist if available

**Set aggressive timeouts.** Every outbound request must have a connection timeout and a read timeout. Unbounded requests enable slowloris-style resource exhaustion.

**Run outbound requests with minimal privileges.** If your app makes outbound requests to fetch external resources, that code path should not have access to internal service credentials.

### Key invariants
- No user-supplied URL is fetched without validation.
- Private IP ranges blocked for all user-influenced outbound requests.
- All outbound requests have explicit timeouts.
- Cloud metadata endpoint (`169.254.169.254`) is never reachable via user input.

---

## 10. Dependency Security

### The threat
Third-party packages introduce vulnerabilities, malicious code, or unexpected behavior that the application inherits.

### What to avoid

- Installing packages without checking known CVEs
- Unpinned dependencies that silently upgrade to a compromised version
- Dev dependencies that ship to production
- Packages that execute install scripts with broad permissions

### What to do instead

**Pin dependencies.** Use a lockfile (`package-lock.json`, `poetry.lock`, `Pipfile.lock`, `go.sum`). Commit the lockfile. Treat unexpected lockfile changes as a red flag.

**Audit before adding.** Before adding a new package, check: How many maintainers? When was the last release? Are there open CVEs? Does the weekly download count suggest broad use and scrutiny? Prefer packages with a track record and a large community.

**Run automated vulnerability scanning.** Use `npm audit`, `pip-audit`, `trivy`, `snyk`, or `dependabot`. Run this in CI and block on CRITICAL/HIGH CVEs.

**Keep dependencies up to date.** The cost of updating is almost always less than the cost of an unpatched vulnerability. Use automated dependency update tools (Dependabot, Renovate).

**Minimize production dependencies.** Every dependency is a potential attack surface. If you can implement it in 20 lines, don't add a package. If a package is dev-only, ensure it never ships to production.

**Do not run arbitrary install scripts.** Many package managers run scripts on install (`postinstall`, `prepare`). Audit what these scripts do, especially for packages from less-known authors.

### Key invariants
- Lockfile committed and reviewed on every change.
- CVE scanning runs in CI.
- Unused or dev-only packages absent from production builds.
