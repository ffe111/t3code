import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { PetSnapshot, PetState, PetThread } from "@t3tools/contracts";

import { hasUnseenCompletion, resolveSidebarRowStatus } from "../Sidebar.logic";

const MAX_THREADS = 8;

// Most urgent first, as the pet shows a single state for every thread at once.
const PRIORITY: ReadonlyArray<Exclude<PetState, "idle">> = [
  "waiting",
  "failed",
  "review",
  "running",
];

export function petStateOfThread(thread: EnvironmentThreadShell): Exclude<PetState, "idle"> | null {
  switch (resolveSidebarRowStatus(thread)) {
    case "approval":
    case "input":
    case "request":
    case "limited":
      return "waiting";
    case "failed":
      return "failed";
    case "working":
    case "preparing":
      return "running";
    case "ready":
      return hasUnseenCompletion(thread) ? "review" : null;
    default:
      return null;
  }
}

export function buildPetSnapshot(threads: ReadonlyArray<EnvironmentThreadShell>): PetSnapshot {
  const counts = { running: 0, waiting: 0, review: 0, failed: 0 };
  const attention: Array<PetThread & { readonly updatedAt: string }> = [];
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const state = petStateOfThread(thread);
    if (state === null) continue;
    counts[state] += 1;
    attention.push({
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title,
      state,
      updatedAt: thread.updatedAt,
    });
  }
  attention.sort(
    (left, right) =>
      PRIORITY.indexOf(left.state as (typeof PRIORITY)[number]) -
        PRIORITY.indexOf(right.state as (typeof PRIORITY)[number]) ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
  return {
    state: attention[0]?.state ?? "idle",
    counts,
    threads: attention
      .slice(0, MAX_THREADS)
      .map(({ updatedAt: _updatedAt, ...thread }): PetThread => thread),
  };
}
