# Security model

This document describes what the product protects, where the trust boundaries sit, which threats shaped the design, what is implemented and what is explicitly not guaranteed. It describes the private system, not this repository, which contains no executable product code.

## 1. Assets

**Company and contact data.** Registration data, addresses, phone numbers, e-mail addresses and websites of prospect companies, plus the interaction history of each one. The commercial value of the system is largely this dataset.

**Personal data of individuals.** Names, qualifications, age bands and masked documents of company partners, taken from the public registry. Names and work e-mail addresses of the sales team. Notes written by salespeople can contain anything a person typed, including names and phone numbers of people they spoke to.

**Commercial performance.** Daily activity per salesperson, conversion, targets and the funnel. This is sensitive inside the company even though it is not personal data.

**Credentials.** Password hashes of the team, the signing secret of the session, the shared secret of the cron endpoint, and the keys of three external providers.

## 2. Trust boundaries

**Browser to server.** Untrusted. Every request may be forged, replayed or modified. The only thing the server accepts from the browser is the signed session cookie and the payload of an action, which is validated.

**Server to database.** Trusted transport, but two different identities. The session pool is a restricted role subject to every policy. The system pool is the schema owner and bypasses policies.

**Server to providers.** Outbound only, server-side only. Responses are untrusted input: they are parsed defensively and never executed or rendered as markup.

**Operator to deployment.** Environment variables, migration runner and database console. Anyone with the schema owner credentials has full access, and no application control applies to them.

## 3. Threats considered

*Reading another salesperson's queue by changing an identifier.* Identifiers are UUIDs, but guessing is not the threat model; a leaked or shared link is. Every read of an assignment or interaction goes through a policy that compares the owner with the actor in the transaction context.

*Escalating from salesperson to manager.* The role travels in the signed cookie and in the transaction context. A forged cookie fails signature verification. A genuine cookie from a demoted user keeps the old role until it expires, which is a known window (see section 5).

*Stealing a session.* The cookie is httpOnly, so a script cannot read it, and SameSite=Lax blocks it from cross-site form posts. The remaining paths are a compromised browser, a leaked signing secret, or an unencrypted transport outside production.

*Guessing passwords.* Hashes are bcrypt with a work factor of 10. There is no rate limit and no lockout, so the defence is password length and the small user base, not throttling.

*Extracting the whole base.* A manager can export everything they can see, by design. A salesperson can only export nothing: the export routes refuse any role but manager. A salesperson can still read their own queue in full, which is the intended scope of their work.

*Leaking provider keys.* Keys are read on the server through the administrative connection and are never included in a page payload. They are stored as plain values in a settings row that only managers can read through the application.

*Abusing the scheduled endpoint.* The cron route requires a shared secret in a header or a query parameter. Without it the route returns 401 and does no work.

*Injection.* Every query uses parameters. The one dynamically assembled statement builds a column list from a fixed allowlist of field names, never from user input.

*Provider compromise or outage.* A provider can return wrong data, partial data or an error. The interface labels a failed source instead of substituting a guess, and timeouts bound every call.

## 4. Controls implemented

- Row Level Security on all ten tables, with the application role created without superuser rights and without `BYPASSRLS`.
- Actor and role written into transaction-local settings on every unit of work; no context means no rows.
- Caller-scoped views, so reporting cannot widen what a policy allows.
- Session and role re-checked in every server action and every export route, independently of the database policy.
- Session cookie httpOnly, SameSite=Lax, Secure in production, eight-hour expiry, signed with HS256.
- Passwords hashed with bcrypt; no query returns a hash to the application except the single login lookup.
- One `SECURITY DEFINER` function for the login lookup, with a pinned search path, a narrow projection and execute revoked from public.
- Settings that hold provider keys readable only by managers; keys resolved on the server, with environment variables taking precedence.
- Exports restricted to managers and filtered by the same policies as the screens.
- Protection of the last active administrator, so the system cannot be left without one.
- Identifiable user agent and explicit timeouts on every outbound call.
- Demonstration mode that can be disabled by configuration, and a fallback that is always labelled in the interface.

## 5. What is not guaranteed

**No multi-factor authentication, no login rate limit, no lockout.** A weak password is a real risk. The product relies on password length and a small, known user base.

**Role changes are not immediate.** The role lives in a signed token valid for eight hours. A user demoted or deactivated keeps the old role in their existing session until it expires, although a deactivated user's next login fails.

**No revocation of a copied token.** Signing out clears the cookie on that browser. A token copied elsewhere stays valid until expiry.

**The system connection bypasses policies.** Registry ingestion, enrichment and round bookkeeping use the schema owner. Their safety depends on the server code that calls them, not on the database. This is the largest single assumption in the design.

**No audit of reads.** Writes are recorded in the interaction table. Reads, exports and logins are not, so the system cannot answer who looked at what.

**No encryption at rest beyond the database provider.** Provider keys sit as plain values in a settings row. Anyone with database access or a backup can read them.

**No application-level transport hardening.** The application does not set a Content-Security-Policy or HSTS headers itself; those depend on the hosting layer.

**CSV exports are not sanitised for spreadsheets.** A value beginning with a formula character is written as is, which is a risk if an export is opened in a spreadsheet application and the data is untrusted.

**Logs are not free of identifiers.** A failed provider call logs the tax ID and the error, not the company name. Operational logs are outside the retention and access controls of the application.

**No formal assurance.** There has been no penetration test, no compliance certification and no third-party review of the policies. The health endpoint reports the database name and role to an unauthenticated caller, which is useful for operations and should be restricted in a hostile deployment.

## 6. Reporting a problem

If you find a weakness in the design as described here, open a private security advisory on this repository or contact the author through the profile linked in the README. Please do not open a public issue with reproduction details. This repository contains no product code, so reports are expected to concern the described mechanisms, the published examples or the documentation.
