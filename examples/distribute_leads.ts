/**
 * Example 2: a balanced, repeatable assignment round.
 *
 * Generic illustration written for this repository, with fictional agents and
 * items. It is not the product implementation and contains no commercial rule.
 *
 * Demonstrates: a Fisher-Yates shuffle over a cryptographic random source, a
 * floor that decides whether a round runs at all, a per-round ceiling with a
 * fair share per agent, and a repeated round that never assigns an item twice.
 *
 * Run with one dependency, no install step beyond it:
 *   npx tsx distribute_leads.ts
 */

import { randomInt } from "node:crypto";

interface Agent {
  id: string;
  open: number;
}

interface RoundOptions {
  floor: number;
  ceiling: number;
}

interface Assignment {
  item: string;
  agent: string;
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function planRound(
  candidates: readonly string[],
  agents: readonly Agent[],
  options: RoundOptions,
  alreadyAssigned: ReadonlySet<string> = new Set(),
): Assignment[] {
  if (agents.length === 0) return [];
  if (!agents.some((agent) => agent.open < options.floor)) return [];

  const fresh = candidates.filter((item) => !alreadyAssigned.has(item));
  const budget = Math.min(options.ceiling, fresh.length);
  if (budget === 0) return [];

  const queue = shuffle(fresh).slice(0, budget);
  const load = new Map(agents.map((agent) => [agent.id, agent.open]));
  const taken = new Map(agents.map((agent) => [agent.id, 0]));
  const share = Math.max(1, Math.ceil(queue.length / agents.length));
  const plan: Assignment[] = [];

  for (const item of queue) {
    const underShare = agents.filter((agent) => (taken.get(agent.id) ?? 0) < share);
    const pool = underShare.length > 0 ? underShare : agents;
    const lightest = Math.min(...pool.map((agent) => load.get(agent.id) ?? 0));
    const tied = pool.filter((agent) => (load.get(agent.id) ?? 0) === lightest);
    const chosen = tied[randomInt(tied.length)];
    load.set(chosen.id, (load.get(chosen.id) ?? 0) + 1);
    taken.set(chosen.id, (taken.get(chosen.id) ?? 0) + 1);
    plan.push({ item, agent: chosen.id });
  }

  return plan;
}

const agents: Agent[] = [
  { id: "agent-a", open: 12 },
  { id: "agent-b", open: 4 },
  { id: "agent-c", open: 7 },
];
const candidates = Array.from({ length: 10 }, (_, index) => `item-${index + 1}`);
const options: RoundOptions = { floor: 10, ceiling: 6 };

const first = planRound(candidates, agents, options);
const assigned = new Set(first.map((entry) => entry.item));
const second = planRound(candidates, agents, options, assigned);
const repeated = second.filter((entry) => assigned.has(entry.item)).length;

console.log(`first round: ${first.length} assignment(s)`);
for (const entry of first) console.log(`  ${entry.item} -> ${entry.agent}`);
console.log(`second round: ${second.length} new, ${repeated} repeated`);
