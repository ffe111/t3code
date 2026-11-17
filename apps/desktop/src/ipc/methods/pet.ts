import { PetSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";
import * as DesktopPet from "../../window/DesktopPet.ts";

export const showPet = DesktopIpc.makeIpcMethod({
  channel: Channels.PET_SHOW_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.pet.show")(function* () {
    yield* (yield* DesktopPet.DesktopPet).show;
  }),
});
export const publishPet = DesktopIpc.makeIpcMethod({
  channel: Channels.PET_PUBLISH_CHANNEL,
  payload: PetSnapshot,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.pet.publish")(function* (snapshot) {
    yield* (yield* DesktopPet.DesktopPet).publish(snapshot);
  }),
});
export const installPetActions = Effect.fn("desktop.ipc.pet.installActions")(function* () {
  yield* (yield* DesktopPet.DesktopPet).installActions;
});
