import * as Schema from "effect/Schema";

export const PetState = Schema.Literals(["idle", "running", "waiting", "review", "failed"]);
export type PetState = typeof PetState.Type;

export const PET_SCALES = [0.5, 0.75, 1, 1.5] as const;

export const PetPreferences = Schema.Struct({
  visible: Schema.Boolean,
  position: Schema.NullOr(Schema.Struct({ x: Schema.Int, y: Schema.Int })),
  scale: Schema.Literals(PET_SCALES),
  // Null uses the built-in pet.
  petId: Schema.NullOr(Schema.String),
});
export type PetPreferences = typeof PetPreferences.Type;

export const PetThread = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
  title: Schema.String,
  state: PetState,
});
export type PetThread = typeof PetThread.Type;

export const PetSnapshot = Schema.Struct({
  // The most urgent state across every connected environment.
  state: PetState,
  // Thread counts per state, for the pet's tooltip.
  counts: Schema.Struct({
    running: Schema.Int,
    waiting: Schema.Int,
    review: Schema.Int,
    failed: Schema.Int,
  }),
  // Most urgent first, capped; the first entry is what a click opens.
  threads: Schema.Array(PetThread),
});
export type PetSnapshot = typeof PetSnapshot.Type;

export const PetOpenThread = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
});
export type PetOpenThread = typeof PetOpenThread.Type;
