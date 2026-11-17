import { useAtomValue } from "@effect/atom-react";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useEffect, useRef } from "react";

import { environmentPresentations } from "../../state/presentation";
import { environmentThreadShells } from "../../state/threads";
import { useUiStateStore } from "../../uiStateStore";
import { buildPetSnapshot } from "./petSnapshot";

/** Every visible thread in every enabled environment, derived only while a pet window exists. */
const petThreadsAtom = Atom.make((get) => {
  const hidden = get(environmentThreadShells.hiddenThreadKeysAtom);
  return [...get(environmentPresentations.presentationsAtom)].flatMap(
    ([environmentId, presentation]) => {
      if (!presentation.entry.enabled) return [];
      const requests = get(environmentThreadShells.pendingSubagentRequestsAtom(environmentId));
      return get(environmentThreadShells.environmentThreadsAtom(environmentId))
        .filter((thread) => !hidden.has(threadKey({ environmentId, threadId: thread.id })))
        .map((thread) =>
          presentThreadShell(environmentId, thread, requests.get(thread.id) ?? null),
        );
    },
  );
}).pipe(Atom.withLabel("desktop-pet-threads"));

export function PetCoordinator() {
  const router = useRouter();
  const threads = useAtomValue(petThreadsAtom);
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const snapshot = buildPetSnapshot(threads, localLastVisitedAtById);
  const publishedKey = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards the derived thread status to the native pet window
  useEffect(() => {
    const key = JSON.stringify(snapshot);
    if (publishedKey.current === key) return;
    publishedKey.current = key;
    void window.desktopBridge?.pet?.publish(snapshot).catch(console.error);
  }, [snapshot]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the native application menu
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action === "show-pet") void window.desktopBridge?.pet?.show().catch(console.error);
      }),
    [],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to clicks on the native pet window
  useEffect(
    () =>
      window.desktopBridge?.pet?.onOpenThread((thread) => {
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: EnvironmentId.make(thread.environmentId),
            threadId: ThreadId.make(thread.threadId),
          },
        });
      }),
    [router],
  );
  return null;
}
