# Decisions

Eight decisions that shaped JER CRM. Each record states the context, the choice, the alternatives that were considered and the consequences that followed, including the ones I would revisit.

## ADR-001: Authorization enforced by Row Level Security

**Context.** The product has two roles with different visibility. A salesperson works only their own queue; a manager sees every queue, every report and every setting. Filtering in the service layer alone means every query carries an obligation, and one forgotten predicate exposes a competitor's pipeline. The team is small, so the guarantee has to survive careless code, not only careful code.

**Decision.** Row Level Security is enabled on every table, and the application connects with a role created without superuser rights and without `BYPASSRLS`. Each unit of work opens a transaction and writes the actor identifier and role into transaction-local settings with `set_config(name, value, true)`. Policies read those settings through stable helper functions. With no context, the helpers return null and no row matches. Reporting views are declared caller-scoped so the same rules apply through them.

**Alternatives.** Filtering exclusively in the service layer; a separate schema or database per role; a policy engine in the application.

**Consequences.** A missing predicate returns nothing instead of leaking, which fails in the safe direction. The cost is that every new service function must open the right transaction, a mistake shows up as empty screens rather than an error, and the database now carries rules that must be migrated with the schema. The policies also add a subquery for interaction rows, which is cheap at this data volume.

## ADR-002: Hand-written SQL on node-postgres, without an ORM

**Context.** The system is built on PostgreSQL features that an ORM would obscure: policies, caller-scoped views, partial indexes, `on conflict` upserts and a `SECURITY DEFINER` function. The same code has to run on a local instance and on a managed provider.

**Decision.** The driver is `pg`, queries are written by hand in the service layer, and results are mapped to domain types by small functions. There is no query builder and no migration generator.

**Alternatives.** A full ORM with a migration tool; a hosted client library tied to one provider; a query builder over the same driver.

**Consequences.** The SQL that runs in development is the SQL that runs in production, and policy behaviour is visible while writing the query. Row counts, `returning` clauses and conflict handling stay explicit. The price is repetition: column lists, upsert blocks and mapping code appear in more than one module, and nothing verifies at compile time that a query matches the schema. With a larger team I would add generated types from the live schema.

## ADR-003: Server actions as the only mutation path, no authentication middleware

**Context.** The application is a set of authenticated pages with forms and buttons. Next.js offers middleware that runs before a route, and it offers server actions that run on the server after a form submission.

**Decision.** Mutations go through server actions. Each action validates its payload, reads the session, checks the role, calls one service and returns a result object. Authentication is enforced in the authenticated layout and in every action. There is no middleware file.

**Alternatives.** Middleware that gates the whole authenticated route group; a separate API layer with client-side fetching; route handlers for every mutation.

**Consequences.** One place per operation decides who may do it, and the check sits next to the code that needs it, which is easier to audit than a matcher pattern. The cost is repetition: the session check is written in every action, and a new action that forgets it is only caught by review, by tests that do not exist yet, or by the policies behind it. Middleware would have centralised the redirect but not the role rules, and it does not protect a service called from a scheduled job.

## ADR-004: A stateless signed session in an httpOnly cookie

**Context.** The product needs a login for a handful of users and no federation, no refresh tokens and no device management. Operating a session table would add a write on every request and a cleanup job.

**Decision.** Login verifies a bcrypt hash and issues a JWT signed with HS256, carrying the user identifier, name, e-mail and role, valid for eight hours. The cookie is httpOnly, SameSite=Lax and Secure in production. The session is read once per request and memoised.

**Alternatives.** Opaque tokens in a session table with server-side revocation; a third-party identity provider; short-lived tokens with refresh rotation.

**Consequences.** No session store, no cleanup, no extra read per request. Revocation is limited: signing out clears the cookie, but a copied token stays valid until it expires, and a role change only takes effect when the token is reissued, up to eight hours later. That window is acceptable for a small internal team and would not be acceptable for a product with external users.

## ADR-005: Two database roles, one for people and one for the system

**Context.** Policies make company records and assignments writable only by managers. But three system routines must write that data without a person behind them: registry ingestion during a scheduled round, enrichment of company records, and bookkeeping of the round itself.

**Decision.** Two pools. The session pool uses the restricted role and always carries an actor context. The system pool uses the schema owner and is reserved for those routines. Functions that touch the system pool perform their own authorization before calling it, and the call sites are few enough to enumerate.

**Alternatives.** Granting the restricted role write access on reference tables and passing a synthetic actor; running scheduled work as a dedicated manager account; moving system writes into `SECURITY DEFINER` functions.

**Consequences.** User traffic never needs elevated rights, and system code stays readable instead of working around policies. The cost is a second connection path that bypasses policies entirely, so a mistake in a caller check is not caught by the database. The functions that use it are the ones most worth reviewing.

## ADR-006: A configuration-driven distribution engine with idempotent writes

**Context.** Refilling the queue was the manual step that failed most often. The provider returns companies by activity code and state, with no notion of which ones the team already has, and the same search returns the same rows every day.

**Decision.** Managers configure activity codes, states, a per-salesperson floor and a per-round ceiling. A round searches the provider for each combination, drops tax IDs already stored, shuffles the candidates with Fisher-Yates over a cryptographic source and assigns them to the least loaded active salespeople. Writes happen in one transaction with a unique constraint on company and salesperson, so a repeated round inserts nothing twice. A round runs from the panel or from an authenticated cron route.

**Alternatives.** Deterministic round-robin assignment; assignment by a score that weighs size, state and activity; an external queue service with a worker.

**Consequences.** The queue refills itself and the split is fair in practice, because random choice inside the least-loaded group removes the ordering bias of the provider. The engine cannot guarantee a global optimum, it depends on the provider returning new companies, and it stops when the quota is exhausted. The idempotency of the write path is what makes a retry safe, and it is the part I would keep in any redesign.

## ADR-007: Cache and quota in front of the metered provider, with a labelled fallback

**Context.** Registry searches are billed and rate limited per minute and per day. The interface also has to be demonstrable without a contract, and a demonstration filled with invented data would be worse than an empty one.

**Decision.** Responses are cached under a hash of the normalised query with a time to live, a daily counter row tracks consumption, and an in-memory sliding window enforces the per-minute limit. Paid search for maps and social profiles is off unless requested. When the provider fails and the fallback is enabled, the result is tagged as demonstration data and the interface prints the reason above the rows.

**Alternatives.** No cache, accepting the cost; trusting the provider to enforce limits; failing the screen with a generic error.

**Consequences.** Repeated searches during a working day cost nothing, and the team sees why a record is incomplete. The counter row is a bottleneck under concurrent writes, the minute window is per process, and the fallback exists only for demonstration, which is a compromise I would remove in a paid deployment.

## ADR-008: Date columns read as text

**Context.** The business runs in one timezone, while the server may run in UTC. A `date` column parsed into a JavaScript `Date` at midnight local time and rendered in another timezone moves by one day, which corrupts "contacts today" and every daily report.

**Decision.** The driver's parser for the `date` type returns the raw `YYYY-MM-DD` string. Timestamps stay timestamps and are converted to the business timezone in SQL when they are grouped by day. Formatting to a human date happens in the presentation layer.

**Alternatives.** Storing everything as `timestamptz` and truncating in SQL; setting the session timezone to the business timezone and accepting `Date` objects; formatting dates in SQL for every screen.

**Consequences.** Daily buckets are stable and a report never disagrees with itself between two screens. The cost is that date strings must be formatted before display and cannot be compared or subtracted without parsing, so a new developer has to learn the convention. It is documented in the architecture and in the code that configures the driver.
