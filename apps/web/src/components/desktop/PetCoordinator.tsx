import { useAtomValue } from "@effect/atom-react";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { EnvironmentId, ThreadId, type PetSnapshot } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { environmentPresentations } from "../../state/presentation";
import { environmentThreadShells } from "../../state/threads";
import { buildPetSnapshot } from "./petSnapshot";

/** Thread statuses across every enabled environment, derived only while a pet window exists. */
const petSnapshotAtom = Atom.make((get) => {
  const hidden = get(environmentThreadShells.hiddenThreadKeysAtom);
  const threads = [...get(environmentPresentations.presentationsAtom)].flatMap(
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
  const next = buildPetSnapshot(threads);
  const previous = Option.getOrNull(get.self<PetSnapshot>());
  return previous !== null && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}).pipe(Atom.withLabel("desktop-pet-snapshot"));

export function PetCoordinator() {
  const router = useRouter();
  const snapshot = useAtomValue(petSnapshotAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards the derived thread status to the native pet window
  useEffect(() => {
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
