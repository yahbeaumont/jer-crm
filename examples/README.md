# Examples

Three small, self-contained illustrations of the techniques described in the main README. They were rewritten from scratch for this repository: generic table, function and variable names, fictional data, no product code and no commercial rule. They demonstrate the mechanism, not the implementation.

| File | Demonstrates | Needs |
|---|---|---|
| `rls_session_context.sql` | Actor context per transaction, a policy that fails closed, and the context disappearing at commit | PostgreSQL 14 or newer, superuser on a scratch database |
| `distribute_leads.ts` | Cryptographic shuffle, floor and ceiling, balanced assignment, repeat round without duplicates | Node 18 or newer and `tsx` |
| `enrichment_cache.ts` | Time to live, per-minute window, daily cap, labelled fallback on failure | Node 18 or newer and `tsx` |

## rls_session_context.sql

Creates a role that cannot bypass policies, a small table with two owners, a helper that reads the actor from the transaction settings, and two policies. It then switches to the application role and runs four checks:

1. With no context, the table returns zero rows and no error.
2. Inside a transaction with the actor set, only that actor's row is visible.
3. After commit, the setting is gone and the table returns zero rows again.
4. A write for another actor is rejected by the policy.

```bash
createdb scratch
psql -d scratch -f rls_session_context.sql
```

Expected output, in order: `0`, `1`, `0`, and a notice that the policy rejected the write. The script removes what a previous run may have left and drops everything it creates, so it can run repeatedly.

## distribute_leads.ts

A pure function that plans one assignment round. It returns early when every agent is at or above the floor, filters items that were already assigned, shuffles the rest with Fisher-Yates over `crypto.randomInt`, and assigns each item to the lightest agent that is still under its share of the round, with a hard ceiling on the round itself.

The demonstration runs a round of six assignments for three fictional agents and then a second round over the same candidate list. The second round reports new assignments and zero repeats.

```bash
npx tsx distribute_leads.ts
```

The file has no imports beyond `node:crypto` and no dependency on the product. `tsx` is the only tool needed, and it is the same runner the product uses for its migration scripts.

## enrichment_cache.ts

A small class around a simulated metered provider. It serves a cached value while the entry is fresh, refuses to call the provider once the daily cap or the per-minute window is exhausted, and returns a labelled fallback with a reason when the provider throws.

The demonstration requests six keys, including one that always fails and two that fall outside the per-minute budget, so the output shows all three sources: `live`, `cache` and `fallback` with the reason printed next to the value.

```bash
npx tsx enrichment_cache.ts
```

The provider is a local function. There is no network call, no API key and no configuration.

## What these examples deliberately omit

The product versions handle more than the examples: database transactions and unique constraints behind the assignment round, provider-specific parsing, persistence of the cache and the counter in PostgreSQL, and the policy set for every table. Those parts are specific to the product and are described in `docs/ARCHITECTURE.md` instead of being reproduced here.
