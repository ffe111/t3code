// @effect-diagnostics globalTimers:off - a renderer preload, outside any Effect runtime.
import { ipcRenderer } from "electron";
import type { PetState } from "@t3tools/contracts";
import {
  PET_ANIMATIONS,
  PET_ANIMATION_ROWS,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  type PetAnimation,
} from "@t3tools/shared/petPackage";
import { PET_ACTION_CHANNEL, PET_SPRITE_CHANNEL, PET_STATE_CHANNEL } from "./ipc/channels.ts";

// A resting pet pauses between breaths so an idle window never repaints continuously.
const IDLE_PAUSE_MS = 6_000;
const DRAG_THRESHOLD_PX = 4;

window.addEventListener(
  "DOMContentLoaded",
  () => {
    const sprite = document.getElementById("sprite")!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let state: PetState = "idle";
    let scale = 1;
    let loaded = false;
    let oneShot: PetAnimation | null = null;
    let index = 0;
    // Set once an idle loop has played, so the pause lands on its resting first frame.
    let rested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const act = (action: string | { readonly dx: number; readonly dy: number }) =>
      void ipcRenderer.invoke(PET_ACTION_CHANNEL, action);

    const showFrame = (animation: PetAnimation, column: number) => {
      const row = PET_ANIMATION_ROWS.indexOf(animation);
      sprite.style.backgroundPosition = `${-column * PET_CELL_WIDTH * scale}px ${-row * PET_CELL_HEIGHT * scale}px`;
    };
    const tick = () => {
      if (!loaded) return;
      const animation = oneShot ?? state;
      const timings = PET_ANIMATIONS[animation];
      showFrame(animation, index);
      // Reduced motion keeps a still frame of the current state.
      if (reducedMotion.matches) return;
      let delay: number = timings[index]!;
      if (animation === "idle" && index === 0 && rested) delay += IDLE_PAUSE_MS;
      index += 1;
      if (index >= timings.length) {
        index = 0;
        if (oneShot !== null) oneShot = null;
        else if (state === "idle") rested = true;
      }
      timer = setTimeout(tick, delay);
    };
    const restart = () => {
      clearTimeout(timer);
      index = 0;
      rested = false;
      tick();
    };
    reducedMotion.addEventListener("change", restart);

    ipcRenderer.on(PET_SPRITE_CHANNEL, (_event, message: { sprite: string; scale: number }) => {
      const image = new Image();
      image.onload = () => {
        scale = message.scale;
        sprite.style.backgroundImage = `url("${message.sprite}")`;
        sprite.style.backgroundSize = `${image.naturalWidth * scale}px ${image.naturalHeight * scale}px`;
        loaded = true;
        restart();
      };
      image.src = message.sprite;
    });
    ipcRenderer.on(PET_STATE_CHANNEL, (_event, message: { state: PetState; summary: string }) => {
      const previous = state;
      state = message.state;
      sprite.title = message.summary;
      sprite.setAttribute(
        "aria-label",
        message.summary === "" ? "T3 Pet" : `T3 Pet: ${message.summary}`,
      );
      if (state === previous) return;
      // Finished work earns one celebratory hop before the pet settles.
      oneShot = state === "review" && previous === "running" ? "jumping" : null;
      restart();
    });

    let start: { x: number; y: number } | null = null;
    let moved = false;
    let frame = 0;
    let latest = { dx: 0, dy: 0 };
    sprite.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.screenX, y: event.screenY };
      moved = false;
      try {
        sprite.setPointerCapture(event.pointerId);
      } catch {
        // The pointer ended before capture; the drag simply continues uncaptured.
      }
      act("drag-start");
    });
    sprite.addEventListener("pointermove", (event) => {
      if (start === null) return;
      latest = { dx: event.screenX - start.x, dy: event.screenY - start.y };
      if (!moved && Math.hypot(latest.dx, latest.dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        act(latest);
      });
    });
    sprite.addEventListener("pointerup", (event) => {
      if (start === null || event.button !== 0) return;
      start = null;
      if (moved) return;
      oneShot = "waving";
      restart();
      act("click");
    });
    sprite.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      act("menu");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") act("click");
    });
    act("ready");
  },
  { once: true },
);
