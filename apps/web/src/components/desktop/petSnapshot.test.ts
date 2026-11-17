import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { buildPetSnapshot, petStateOfThread } from "./petSnapshot";

const OPENED = "2026-11-16T10:00:00.000Z";
const FINISHED_AFTER = "2026-11-16T11:00:00.000Z";

function thread(overrides: Record<string, unknown>): EnvironmentThreadShell {
  return {
    environmentId: "desk",
    id: "t1",
    title: "A thread",
    archivedAt: null,
    updatedAt: FINISHED_AFTER,
    lastVisitedAt: OPENED,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    runtime: null,
    latestRun: null,
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

const completed = (completedAt: string) => ({
  runId: "r1",
  status: "completed",
  requestedAt: OPENED,
  startedAt: OPENED,
  completedAt,
  assistantMessageId: null,
});

describe("petStateOfThread", () => {
  it.each([
    ["an approval request", { hasPendingApprovals: true }, "waiting"],
    ["a question", { hasPendingUserInput: true }, "waiting"],
    ["a running turn", { runtime: { status: "running" } }, "running"],
    ["a connecting turn", { runtime: { status: "starting" } }, "running"],
    [
      "a failed run nobody opened",
      {
        latestRun: { ...completed(FINISHED_AFTER), status: "failed" },
        runtime: { status: "failed" },
      },
      "failed",
    ],
    ["a finished run nobody opened", { latestRun: completed(FINISHED_AFTER) }, "review"],
    ["a finished run already opened", { latestRun: completed("2026-11-16T09:00:00.000Z") }, null],
    ["a quiet thread", {}, null],
  ])("maps %s", (_name, overrides, expected) => {
    expect(petStateOfThread(thread(overrides))).toBe(expected);
  });
});

describe("buildPetSnapshot", () => {
  it("shows the most urgent state and orders threads for the click target", () => {
    const snapshot = buildPetSnapshot([
      thread({ id: "running", runtime: { status: "running" }, title: "Building" }),
      thread({ id: "done", latestRun: completed(FINISHED_AFTER), title: "Done" }),
      thread({ id: "ask", hasPendingUserInput: true, title: "Question" }),
      thread({ id: "archived", hasPendingUserInput: true, archivedAt: OPENED }),
    ]);
    expect(snapshot.state).toBe("waiting");
    expect(snapshot.counts).toEqual({ running: 1, waiting: 1, review: 1, failed: 0 });
    expect(snapshot.threads.map((entry) => entry.threadId)).toEqual(["ask", "done", "running"]);
  });

  it("rests when nothing needs attention and caps the thread list", () => {
    expect(buildPetSnapshot([thread({})])).toEqual({
      state: "idle",
      counts: { running: 0, waiting: 0, review: 0, failed: 0 },
      threads: [],
    });
    const many = Array.from({ length: 20 }, (_, index) =>
      thread({ id: `t${index}`, runtime: { status: "running" } }),
    );
    expect(buildPetSnapshot(many).threads).toHaveLength(8);
    expect(buildPetSnapshot(many).counts.running).toBe(20);
  });
});
