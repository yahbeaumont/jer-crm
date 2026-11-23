# Case study

## The brief

An industrial automation distributor sells components to factories. Its commercial team does not wait for inbound interest: it picks a slice of the market by economic activity code, buys a list of companies that match, and calls them. The list is the raw material of the business.

The list arrived as a spreadsheet: someone exported it from a registry provider, split the rows between salespeople and pasted phone numbers into WhatsApp Web. The team had no queue that refilled itself, no fair split and no record of what had been tried.

I was asked to replace that, not with a generic CRM with a pipeline editor, but with a tool shaped around one motion: opening a company, seeing who to call, calling them, and recording what happened in two clicks.

## Constraints

**One engineer, no operations team.** One process, one database, diagnosable from logs and a health endpoint.

**A metered data source.** The registry provider charges per search and limits requests per minute and per day. Ingestion had to work inside that budget.

**Real personal data.** Records include partners from the public registry. That data is public but still personal, and partner phone numbers are not published at all, which the interface has to say instead of inventing them.

**A sales team, not engineers.** A screen that needs three clicks to start a WhatsApp conversation does not get used, and a number that opens an empty conversation costs a call.

**No test suite.** There was no test culture to inherit and no time to build one during the first delivery, the first thing I would change.

## What was built

A Next.js application with PostgreSQL behind it: eleven pages, thirty server actions, fifteen service modules, ten tables and twenty-three access policies, applied by five SQL migrations.

A salesperson gets a queue grouped by stage, with search and a shortcut to the oldest untouched company. The company record shows registration data, activity code, size, address, phone, e-mail, website, partners and social profiles, with actions for WhatsApp, e-mail, phone and maps. Every action records an interaction with date, time and author, and a seven-stage pipeline tracks the conversation.

A manager sees the whole team, the funnel, today against yesterday, a fourteen-day series, a ranking, monthly conversion, recent interactions, transfers and CSV exports.

The engine changed the nature of the product: it watches activity codes and states, searches the provider on a schedule, discards companies already stored and assigns the rest to the least loaded salespeople.

## The four hard problems

### 1. Making the database the authority without breaking login

Row Level Security needs to know who is asking, and the answer has to arrive with the query, not with the connection, because connections are pooled and shared.

Every unit of work opens a transaction and calls `set_config` with the user identifier and the role, marked local so the values disappear at commit. Policies read those settings through stable helpers, so a pooled connection carries no identity between requests.

Login was the first problem. It happens before there is an actor, and the accounts table is protected like everything else, so reading it to verify a password would be blocked by its own policy. The fix is one database function, owned by the schema owner, returning exactly the six columns needed to authenticate an e-mail, with execute revoked from public and the search path pinned.

The second appeared later, when two new tables were added with policies but without privileges for the application role. PostgreSQL checks privileges before policies, so the screen failed with a permission error instead of an empty list. A fifth migration granted read access and left the policy to decide the rows. In this model a new table needs three things, not one.

### 2. A refill that is fair, repeatable and cheap

The first version had manual import only: a manager picked a list and a salesperson. That replaced the spreadsheet without keeping the queue full.

The engine had to answer three questions at once. Which companies are new? Who should get each one? What happens if the round runs twice?

Newness is a set difference against stored tax IDs. Fairness is a shuffle followed by assignment to the least loaded salesperson, with a ceiling per round. Repeatability comes from the database: a unique constraint on company and salesperson and an upsert that does nothing on conflict.

Two details took longer. Head office and branches have different tax IDs and the same commercial value, so candidates are collapsed by the first digits of the tax ID before the shuffle. And an error on one activity code and state combination must not discard what was collected, so each combination records its own error and the round continues.

### 3. Data that admits where it came from

A company record is assembled from four sources with different costs. The company's website is free and often lists social profiles. The commercial provider is metered and has the registration data. A public registry mirror has the partners. A search API has maps and profiles and charges per call.

The rule is that the interface never presents a guess as a fact. Enrichment runs free sources first and paid sources on request, and each record stores which source produced its data. When a source fails, the result carries a warning and the interface prints it; when the provider is down and the fallback is enabled, rows are labelled as demonstration data.

Two smaller lessons. A public API rejected the default user agent of the Node runtime with a 403, so external calls now send an identifiable agent. And batch enrichment had to be bounded: six workers keep a round inside the scheduled window without exhausting the per-minute limit.

### 4. A record that survives the state it describes

The first reporting attempt read the current stage of each assignment and counted. It was wrong in a way that took a week to notice: moving an assignment forward erased the fact that it had been behind, so the funnel looked healthy while the team skipped stages.

The correction was to treat the interaction table as the record and the assignment as a cache of the latest state. Every action appends a row with the previous stage, the new stage, the actor and the time, in the same transaction that updates the assignment. Reporting reads a view over interactions grouped by salesperson and day, converted to the business timezone inside SQL.

That change also fixed a class of timezone bugs. Date columns are read as text by the driver, so a business date cannot shift by a day when the server runs in UTC, and daily numbers agree between the panel and the export.

## What changed along the way

The product started as an import tool and became an ingestion system. The second commit delivered the CRM with manual import; the third added the automatic engine, partners, social discovery and WhatsApp alerts. The engine is not a feature I planned. It is what the client needed after using the first version for a week.

Maps validation moved from a dedicated places API to the search provider, because one paid account was easier to explain and cap than two. Social discovery started as a paid search per network and became a free read of the company's own site, with paid search as fallback.

## What I would do differently

**Tests around the policies.** The riskiest code is not the SQL that returns rows but the SQL that decides who may see them. A harness that seeds two actors and asserts what each can read, write and export would have caught the missing grants.

**One connection path with explicit elevation.** Two pools work, but the second bypasses policies and depends on discipline at the call sites. Switching role inside a transaction would keep one pool and one mental model.

**A queue for enrichment.** Today it runs inside the request or the round; a job table with retries would keep both short.

**Revocation before expiry.** A signed session valid for eight hours is the right trade for an internal team and the wrong one for a product with external users.

What I would keep is what carried the weight: authorization in the database, the interaction table as the source of truth, and an ingestion path that is idempotent by construction.
