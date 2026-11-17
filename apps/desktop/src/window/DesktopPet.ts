import { PET_SCALES, type PetPreferences, type PetSnapshot } from "@t3tools/contracts";
import { PET_CELL_HEIGHT, PET_CELL_WIDTH, parsePetReference } from "@t3tools/shared/petPackage";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as HttpClient from "effect/http/HttpClient";
import * as Semaphore from "effect/Semaphore";
import * as Electron from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as Channels from "../ipc/channels.ts";
import {
  BUILT_IN_PET,
  loadPetSprite,
  scanPets,
  type PetInfo,
  type PetLoadFailure,
} from "../pet/petLibrary.ts";
import { installPet } from "../pet/petInstaller.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import { PET_DOCUMENT } from "./petDocument.ts";
import { usageWidgetBounds } from "./usageWidgetBounds.ts";

export class DesktopPet extends Context.Service<
  DesktopPet,
  {
    readonly keepsMainAlive: () => boolean;
    readonly show: Effect.Effect<void, ElectronWindow.ElectronWindowCreateError>;
    readonly publish: (
      snapshot: PetSnapshot,
    ) => Effect.Effect<void, ElectronWindow.ElectronWindowCreateError>;
    readonly installActions: Effect.Effect<
      void,
      DesktopIpc.DesktopIpcRegistrationError,
      Scope.Scope
    >;
  }
>()("@t3tools/desktop/window/DesktopPet") {}

const SCALE_LABELS: Record<(typeof PET_SCALES)[number], string> = {
  0.5: "Small",
  0.75: "Medium",
  1: "Large",
  1.5: "Extra large",
};

const IDLE_SNAPSHOT: PetSnapshot = {
  state: "idle",
  counts: { running: 0, waiting: 0, review: 0, failed: 0 },
  threads: [],
};

function summarize(counts: PetSnapshot["counts"]): string {
  return [
    counts.waiting > 0 ? `${counts.waiting} need input` : null,
    counts.failed > 0 ? `${counts.failed} blocked` : null,
    counts.review > 0 ? `${counts.review} ready` : null,
    counts.running > 0 ? `${counts.running} running` : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

const make = Effect.gen(function* () {
  const windows = yield* ElectronWindow.ElectronWindow;
  const settings = yield* DesktopAppSettings.DesktopAppSettings;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state = yield* DesktopState.DesktopState;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const mutex = yield* Semaphore.make(1);
  const petsDirectory = path.join(environment.baseDir, "pets");
  let preferences: PetPreferences | undefined;
  let pet: Electron.BrowserWindow | undefined;
  let snapshot: PetSnapshot = IDLE_SNAPSHOT;
  let library: { pets: readonly PetInfo[]; failures: readonly PetLoadFailure[] } = {
    pets: [BUILT_IN_PET],
    failures: [],
  };
  let moveFiber: Fiber.Fiber<void> | undefined;
  let disposing = false;
  let dragOrigin: { x: number; y: number } | undefined;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runSync = Effect.runSyncWith(context);

  const persist = Effect.suspend(() =>
    preferences === undefined
      ? Effect.void
      : settings.setPet(preferences).pipe(
          Effect.catch((error) => Effect.logWarning("Could not save pet preferences.", error)),
          Effect.asVoid,
        ),
  );
  const initialize = Effect.gen(function* () {
    preferences ??= (yield* settings.get).pet;
  });
  const refreshLibrary = Effect.gen(function* () {
    library = yield* scanPets(petsDirectory).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  });
  const selectedPet = () =>
    library.pets.find((candidate) => candidate.id === preferences?.petId) ?? BUILT_IN_PET;

  const sendState = () => {
    if (pet && !pet.isDestroyed()) {
      pet.webContents.send(Channels.PET_STATE_CHANNEL, {
        state: snapshot.state,
        summary: summarize(snapshot.counts),
      });
    }
  };
  const sendSprite = Effect.gen(function* () {
    if (!pet || pet.isDestroyed() || !preferences) return;
    const sprite = yield* loadPetSprite(selectedPet()).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.orElseSucceed(() => null),
    );
    if (!pet || pet.isDestroyed() || sprite === null) return;
    pet.webContents.send(Channels.PET_SPRITE_CHANNEL, {
      sprite,
      scale: preferences.scale,
    });
  });
  const size = () => {
    const scale = preferences?.scale ?? 0.75;
    return {
      width: Math.round(PET_CELL_WIDTH * scale),
      height: Math.round(PET_CELL_HEIGHT * scale),
    };
  };
  const place = (restorePosition: boolean) => {
    if (!pet || pet.isDestroyed() || !preferences) return;
    const position = restorePosition ? preferences.position : pet.getBounds();
    const display = position
      ? Electron.screen.getDisplayNearestPoint(position)
      : Electron.screen.getPrimaryDisplay();
    pet.setBounds(usageWidgetBounds(position, size(), display.workArea));
  };
  const rememberPosition = () => {
    if (!pet || pet.isDestroyed() || !preferences) return;
    const { x, y } = pet.getBounds();
    preferences = { ...preferences, position: { x, y } };
  };
  const flushPosition = mutex.withPermit(
    Effect.gen(function* () {
      rememberPosition();
      yield* persist;
    }),
  );

  const revealMain = Effect.gen(function* () {
    const main = yield* windows.main;
    if (Option.isSome(main)) yield* windows.reveal(main.value);
  });
  const openThread = Effect.gen(function* () {
    const main = yield* windows.main;
    if (Option.isNone(main) || main.value.isDestroyed()) return;
    const [target] = snapshot.threads;
    if (target) main.value.webContents.send(Channels.PET_OPEN_THREAD_CHANNEL, target);
    yield* windows.reveal(main.value);
  });

  const ensure = Effect.gen(function* () {
    yield* initialize;
    if (!preferences!.visible || (pet && !pet.isDestroyed())) return;
    yield* refreshLibrary;
    const { width, height } = size();
    const created = yield* windows.create(
      {
        width,
        height,
        show: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: "#00000000",
        title: "T3 Pet",
        webPreferences: {
          preload: path.join(path.dirname(environment.preloadPath), "pet-preload.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: "pet",
        },
      },
      { auxiliary: true },
    );
    pet = created;
    created.setAlwaysOnTop(true, "floating");
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.on("move", () => {
      if (moveFiber) runFork(Fiber.interrupt(moveFiber));
      moveFiber = runFork(Effect.sleep(300).pipe(Effect.andThen(flushPosition)));
    });
    created.on("closed", () => {
      if (pet !== created) return;
      pet = undefined;
      if (!disposing && !runSync(Ref.get(state.quitting)) && preferences?.visible) {
        preferences = { ...preferences, visible: false };
        runFork(revealMain.pipe(Effect.andThen(persist)));
      }
    });
    created.webContents.on("render-process-gone", () => created.destroy());
    place(true);
    yield* Effect.promise(() =>
      created
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PET_DOCUMENT)}`)
        .catch(() => {
          created.destroy();
        }),
    );
  });

  const hide = Effect.gen(function* () {
    yield* initialize;
    if (!preferences!.visible) return;
    // Never leave the app running with no visible way to recover it on Windows/Linux.
    yield* revealMain;
    rememberPosition();
    preferences = { ...preferences!, visible: false };
    if (pet && !pet.isDestroyed()) pet.destroy();
    yield* persist;
  });
  const show = mutex.withPermit(
    Effect.gen(function* () {
      yield* initialize;
      preferences = { ...preferences!, visible: true };
      yield* ensure;
      yield* persist;
      if (pet && !pet.isDestroyed()) {
        sendState();
        pet.showInactive();
      }
    }),
  );
  const publish = Effect.fn("desktop.pet.publish")((next: PetSnapshot) =>
    mutex.withPermit(
      Effect.gen(function* () {
        snapshot = next;
        yield* ensure;
        sendState();
      }),
    ),
  );

  const choosePet = (petId: string) =>
    mutex.withPermit(
      Effect.gen(function* () {
        if (!preferences) return;
        preferences = { ...preferences, petId };
        yield* sendSprite;
        yield* persist;
      }),
    );
  const chooseScale = (scale: (typeof PET_SCALES)[number]) =>
    mutex.withPermit(
      Effect.gen(function* () {
        if (!preferences) return;
        rememberPosition();
        preferences = { ...preferences, scale };
        place(false);
        yield* sendSprite;
        yield* persist;
      }),
    );
  const refreshPets = mutex.withPermit(
    Effect.gen(function* () {
      yield* refreshLibrary;
      yield* sendSprite;
    }),
  );
  const openPetsFolder = Effect.gen(function* () {
    yield* fileSystem.makeDirectory(petsDirectory, { recursive: true }).pipe(Effect.ignore);
    yield* Effect.promise(() => Electron.shell.openPath(petsDirectory));
  });

  const removePet = Effect.fn("desktop.pet.remove")(function* (target: PetInfo) {
    // Only a folder directly inside the pets folder can be removed, never anything else on disk.
    if (
      target.builtIn ||
      target.directory === null ||
      path.dirname(target.directory) !== petsDirectory
    ) {
      return;
    }
    const choice = yield* Effect.promise(() =>
      Electron.dialog.showMessageBox({
        type: "question",
        buttons: ["Remove", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        message: `Remove ${target.displayName}?`,
        detail: "Its files are deleted from the pets folder.",
      }),
    );
    if (choice.response !== 0) return;
    yield* fileSystem.remove(target.directory, { recursive: true }).pipe(Effect.ignore);
    yield* refreshPets;
    if (selectedPet().id === target.id || preferences?.petId === target.id) {
      yield* choosePet(BUILT_IN_PET.id);
    }
  });
  const notify = (body: string) =>
    Effect.sync(() => {
      if (Electron.Notification.isSupported()) {
        new Electron.Notification({ title: "T3 Pet", body }).show();
      }
    });
  // A pet is copied from its page as an id or an install command, so the clipboard is the input.
  const addFromClipboard = Effect.gen(function* () {
    const id = parsePetReference(yield* Effect.promise(() => Electron.clipboard.readText()));
    if (id === null) {
      yield* notify(
        "Copy a pet id or its install command first, then choose Add pet from clipboard.",
      );
      return;
    }
    const result = yield* installPet({ petsDirectory, id }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(HttpClient.HttpClient, httpClient),
      Effect.map((installed) => ({ ok: true as const, installed })),
      Effect.catch((message: string) => Effect.succeed({ ok: false as const, message })),
    );
    if (!result.ok) {
      yield* notify(`Could not add ${id}. ${result.message}`);
      return;
    }
    yield* refreshPets;
    yield* choosePet(result.installed.id);
    yield* notify(`Added ${result.installed.displayName}.`);
  });

  const showMenu = Effect.sync(() => {
    if (!pet || pet.isDestroyed() || !preferences) return;
    const current = selectedPet();
    const menu = Electron.Menu.buildFromTemplate([
      { label: "Open T3 Code", click: () => runFork(revealMain) },
      { type: "separator" },
      {
        label: "Pet",
        submenu: [
          ...library.pets.map((candidate): Electron.MenuItemConstructorOptions => ({
            label: candidate.displayName,
            type: "radio",
            checked: candidate.id === current.id,
            click: () => runFork(choosePet(candidate.id)),
          })),
          ...library.failures.map((failure): Electron.MenuItemConstructorOptions => ({
            label: `Skipped ${failure.folder}: ${failure.error}`,
            enabled: false,
          })),
          { type: "separator" },
          { label: "Add pet from clipboard", click: () => runFork(addFromClipboard) },
          ...(current.builtIn
            ? []
            : [
                {
                  label: `Remove ${current.displayName}...`,
                  click: () => runFork(removePet(current)),
                } satisfies Electron.MenuItemConstructorOptions,
              ]),
          { label: "Refresh pets", click: () => runFork(refreshPets) },
          { label: "Open pets folder", click: () => runFork(openPetsFolder) },
        ],
      },
      {
        label: "Size",
        submenu: PET_SCALES.map((scale): Electron.MenuItemConstructorOptions => ({
          label: SCALE_LABELS[scale],
          type: "radio",
          checked: scale === preferences?.scale,
          click: () => runFork(chooseScale(scale)),
        })),
      },
      { type: "separator" },
      { label: "Hide pet", click: () => runFork(mutex.withPermit(hide)) },
    ]);
    menu.popup({ window: pet });
  });

  const actionIpc = DesktopIpc.make(Electron.ipcMain, (event) =>
    Effect.sync(
      () =>
        pet !== undefined &&
        !pet.isDestroyed() &&
        event.sender.id === pet.webContents.id &&
        event.senderFrame === pet.webContents.mainFrame,
    ),
  );
  const installActions = Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        disposing = true;
        if (moveFiber) yield* Fiber.interrupt(moveFiber);
        yield* flushPosition;
        if (pet && !pet.isDestroyed()) pet.destroy();
      }),
    );
    yield* actionIpc.handle(
      DesktopIpc.makeIpcMethod({
        channel: Channels.PET_ACTION_CHANNEL,
        payload: Schema.Union([
          Schema.Literals(["ready", "click", "menu", "drag-start"]),
          Schema.Struct({ dx: Schema.Int, dy: Schema.Int }),
        ]),
        result: Schema.Void,
        handler: Effect.fn("desktop.pet.action")(function* (action) {
          if (!pet || pet.isDestroyed() || !preferences) return;
          if (typeof action === "object") {
            // Dragging is handled here because a drag region would swallow clicks and the menu.
            if (dragOrigin) pet.setPosition(dragOrigin.x + action.dx, dragOrigin.y + action.dy);
            return;
          }
          switch (action) {
            case "ready":
              yield* sendSprite;
              sendState();
              pet.showInactive();
              return;
            case "drag-start": {
              const [x, y] = pet.getPosition();
              dragOrigin = { x: x!, y: y! };
              return;
            }
            case "click":
              yield* openThread;
              return;
            case "menu":
              yield* showMenu;
              return;
          }
        }),
      }),
    );
  });

  return DesktopPet.of({
    keepsMainAlive: () => pet !== undefined && !pet.isDestroyed(),
    show,
    publish,
    installActions,
  });
});

export const layer = Layer.effect(DesktopPet, make);
export const layerTest = Layer.succeed(DesktopPet, {
  keepsMainAlive: () => false,
  show: Effect.void,
  publish: Effect.fn("DesktopPet.publish")(() => Effect.void),
  installActions: Effect.void,
});
