# T3 Pet

T3 Pet is a small animated companion that floats above your other windows and shows what your
threads are doing, so you can work in another app and still notice when an agent needs you. It is
available in the desktop app and is off by default.

## Start it

Choose **View > Show Pet**. Drag it to move it. Right-click it for its menu: pick a pet, change its
size, refresh the pet list, open the pets folder, or hide it. T3 Code remembers the pet, size, and
position.

Click the pet to open the thread that needs you most. With nothing waiting, a click opens T3 Code.
Closing the main window while the pet is showing hides the window and keeps T3 Code running. Hiding
the pet brings the main window back. **Quit** exits both.

## What it shows

The pet reflects every thread in every connected environment. When several threads have something
to report, the most urgent state wins.

| Pet     | Meaning                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| Asking  | A thread needs an approval, an answer, or has hit a usage limit.                         |
| Blocked | A thread failed and you have not opened it yet.                                          |
| Ready   | A thread finished and you have not opened it yet. The pet hops once when work completes. |
| Working | A thread is running.                                                                     |
| Resting | Nothing needs attention.                                                                 |

Hover the pet to see the counts. A resting pet moves once, then holds still for several seconds. With
your system's reduced motion setting on, the pet shows a still frame.

## Install more pets

A pet is a folder with two files, placed in the `pets` folder of your T3 home (right-click the pet,
then **Pet > Open pets folder**). Choose **Refresh pets** afterward.

```
pets/
  my-pet/
    pet.json
    spritesheet.webp
```

`pet.json` names the pet and its image:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A short description.",
  "spritesheetPath": "spritesheet.webp"
}
```

The spritesheet is a `.webp` or `.png`, up to 8 MB, 1536 pixels wide and 1872 or 2288 pixels tall. It
is a grid of 8 columns and 9 or more rows of 192 by 208 pixel cells with a transparent background.
Each row is one animation, from the top: resting, running right, running left, waving, jumping,
blocked, asking, working, ready. Only the first frames of each row are used. Rows 10 and 11, if
present, are ignored.

A pet that cannot be read is listed as skipped in the pet menu with the reason. Only install pets
you have the right to use, since many are made by fans from existing characters.

## Limits

- On Windows, the transparent area around a pet can still catch clicks.
- On Linux with Wayland, staying above other windows and remembering the position depend on your
  window manager.
- A finished thread counts as Ready only when the server records when you last opened it.
