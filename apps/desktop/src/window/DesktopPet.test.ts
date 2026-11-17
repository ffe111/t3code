import * as NodeEvents from "node:events";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Electron from "electron";
import type { PetSnapshot } from "@t3tools/contracts";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import {
  PET_ACTION_CHANNEL,
  PET_OPEN_THREAD_CHANNEL,
  PET_SPRITE_CHANNEL,
  PET_STATE_CHANNEL,
} from "../ipc/channels.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopPet from "./DesktopPet.ts";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  shell: { openPath: vi.fn() },
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
  },
}));

function fakeWindow(id: number) {
  let destroyed = false;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  const webContents = Object.assign(new NodeEvents.EventEmitter(), {
    id,
    mainFrame: {},
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  });
  const native = Object.assign(new NodeEvents.EventEmitter(), {
    webContents,
    isDestroyed: () => destroyed,
    getBounds: () => bounds,
    setBounds: (next: typeof bounds) => {
      bounds = next;
    },
    getPosition: () => [bounds.x, bounds.y],
    setPosition: (x: number, y: number) => {
      bounds = { ...bounds, x, y };
    },
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    showInactive: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    destroy: () => {
      destroyed = true;
      native.emit("closed");
    },
  });
  return { native, window: native as unknown as Electron.BrowserWindow };
}

const asking: PetSnapshot = {
  state: "waiting",
  counts: { running: 1, waiting: 1, review: 0, failed: 0 },
  threads: [
    { environmentId: "desk", threadId: "ask", title: "Question", state: "waiting" },
    { environmentId: "desk", threadId: "run", title: "Build", state: "running" },
  ],
};

type Action = string | { readonly dx: number; readonly dy: number };

function withPet<A, E, R>(
  effect: (harness: {
    pet: DesktopPet.DesktopPet["Service"];
    created: ReturnType<typeof fakeWindow>[];
    main: ReturnType<typeof fakeWindow>;
    revealed: Electron.BrowserWindow[];
    action: (action: Action, trusted?: boolean) => Effect.Effect<unknown>;
  }) => Effect.Effect<A, E, R>,
  visible: boolean,
) {
  return Effect.gen(function* () {
    vi.clearAllMocks();
    const created: ReturnType<typeof fakeWindow>[] = [];
    const main = fakeWindow(1);
    const revealed: Electron.BrowserWindow[] = [];
    return yield* Effect.gen(function* () {
      const pet = yield* DesktopPet.DesktopPet;
      yield* pet.installActions;
      const handler = vi
        .mocked(Electron.ipcMain.handle)
        .mock.calls.find(([channel]) => channel === PET_ACTION_CHANNEL)![1];
      const action = (value: Action, trusted = true) => {
        const source = trusted ? created.at(-1)!.native : main.native;
        return Effect.promise(() =>
          Promise.resolve(
            handler(
              {
                sender: source.webContents,
                senderFrame: source.webContents.mainFrame,
              } as unknown as Electron.IpcMainInvokeEvent,
              value,
            ),
          ),
        );
      };
      return yield* effect({ pet, created, main, revealed, action });
    }).pipe(
      Effect.provide(
        DesktopPet.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ElectronWindow.ElectronWindow)({
                main: Effect.succeedSome(main.window),
                create: () =>
                  Effect.sync(() => {
                    const next = fakeWindow(created.length + 2);
                    created.push(next);
                    return next.window;
                  }),
                reveal: (window) =>
                  Effect.sync(() => {
                    revealed.push(window);
                  }),
              }),
              DesktopEnvironment.layer({
                dirname: "/app",
                homeDirectory: "/pet-test",
                platform: "win32",
                processArch: "x64",
                appVersion: "0.0.0",
                appPath: "/app",
                isPackaged: false,
                resourcesPath: "/app/resources",
                runningUnderArm64Translation: false,
              }).pipe(
                Layer.provide(DesktopConfig.layerTest({})),
                Layer.provide(NodeServices.layer),
              ),
              DesktopState.layer,
              NodeHttpClient.layerUndici,
              DesktopAppSettings.layerTest({
                ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
                pet: { visible, position: null, scale: 0.75, petId: null },
              }),
            ),
          ),
        ),
      ),
      Effect.scoped,
    );
  }).pipe(Effect.provide(NodeServices.layer));
}

const lastCall = (send: ReturnType<typeof vi.fn>, channel: string) =>
  send.mock.calls.findLast(([sent]) => sent === channel)?.[1];

describe("DesktopPet", () => {
  it.effect("stays hidden until shown, then sizes itself from the chosen scale", () =>
    withPet(
      ({ pet, created }) =>
        Effect.gen(function* () {
          yield* pet.publish(asking);
          expect(created).toHaveLength(0);
          expect(pet.keepsMainAlive()).toBe(false);
          yield* pet.show;
          yield* pet.show;
          expect(created).toHaveLength(1);
          expect(pet.keepsMainAlive()).toBe(true);
          expect(created[0]!.native.getBounds()).toMatchObject({ width: 144, height: 156 });
        }),
      false,
    ),
  );

  it.effect(
    "sends the sprite and state, follows a drag, and opens the most urgent thread on click",
    () =>
      withPet(
        ({ pet, created, revealed, main, action }) =>
          Effect.gen(function* () {
            yield* pet.publish(asking);
            expect(created).toHaveLength(1);
            const { send } = created[0]!.native.webContents;
            yield* action("ready");
            expect(lastCall(send, PET_SPRITE_CHANNEL)).toMatchObject({
              scale: 0.75,
              sprite: expect.stringMatching(/^data:image\/webp;base64,/),
            });
            expect(lastCall(send, PET_STATE_CHANNEL)).toEqual({
              state: "waiting",
              summary: "1 need input, 1 running",
            });

            const native = created[0]!.native;
            native.setPosition(100, 200);
            yield* action("drag-start");
            yield* action({ dx: 30, dy: -10 });
            expect(native.getBounds()).toMatchObject({ x: 130, y: 190 });

            yield* action("click");
            expect(lastCall(main.native.webContents.send, PET_OPEN_THREAD_CHANNEL)).toMatchObject({
              environmentId: "desk",
              threadId: "ask",
            });
            expect(revealed).toEqual([main.window]);
          }),
        true,
      ),
  );

  it.effect("ignores actions from any window but its own", () =>
    withPet(
      ({ pet, created, action }) =>
        Effect.gen(function* () {
          yield* pet.publish(asking);
          const native = created[0]!.native;
          native.setPosition(10, 10);
          expect(Exit.isFailure(yield* Effect.exit(action("drag-start", false)))).toBe(true);
          expect(Exit.isFailure(yield* Effect.exit(action("click", false)))).toBe(true);
        }),
      true,
    ),
  );

  it.effect("rests the pet again when no thread needs attention", () =>
    withPet(
      ({ pet, created, action }) =>
        Effect.gen(function* () {
          yield* pet.publish(asking);
          yield* action("ready");
          yield* pet.publish({
            state: "idle",
            counts: { running: 0, waiting: 0, review: 0, failed: 0 },
            threads: [],
          });
          expect(lastCall(created[0]!.native.webContents.send, PET_STATE_CHANNEL)).toEqual({
            state: "idle",
            summary: "",
          });
        }),
      true,
    ),
  );
});
