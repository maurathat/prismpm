# The workbench's theme

The workbench opens in **Hologram Dark**: the Hologram brand kit's chrome around a code area that is VS Code's Dark+, ground and colours. Nothing here is written by hand except this file.

| File | What it is |
|---|---|
| `hologram-dark.json` | A VS Code colour theme, written by `tools/build-theme.mjs` from the kit's `brand/tokens/hologram-tokens.json` (the `hologram-dark` set) |
| `hologram-tokens.css` | The same tokens as CSS variables, for the strip above the workbench (`model.html`) |

The kit, its commit and the BLAKE3 label of its token file are in `tools/brand-pins.json`. To follow a newer kit: change the commit and label there, run `node tools/build-theme.mjs`, and commit what it writes. A token the theme needs and the kit does not have stops the build; none is invented here.

## What comes from where

- **The kit:** the page's ground (`#151312`), the panel and the terminal, text, muted text, borders, the bars, lists, menus, fields, buttons, and the colours of errors and warnings.
- **VS Code's Dark+:** the code area. Its ground (`#1e1e1e`), the open tab over it, the line the cursor is on, what is selected, plain text (`#d4d4d4`), and every colour of code, for LexLean and for any other language. The kit has no colours for code, and the owner asked that the code area read as it does in VS Code. The values are in `tools/build-theme.mjs` (`DARK_PLUS`).
- **VS Code itself, untouched:** the editor's font and its size, the terminal's sixteen colours, bracket colours.
- **The accent** (`#e93b01`) colours one thing: the line over the open tab. The kit allows it once in a view and never as a general highlight.
- Dividers are the kit's hairlines. No shadows.
- **A control's edge at rest** (fields, dropdowns, checkboxes, the settings editor's fields) is the kit's subtle text grey, `muted-foreground-subtle` (the owner's choice): neither border role of the kit reaches 3:1. **In focus** it is the kit's ring, which is nearly the same colour, so `focus.css` draws it at the kit's ring width, 2px against 1px at rest. `focus.css` is the one other file here written by hand.

## Checked

`node tools/theme-test.mjs --fetch` (in CI): every text pair is at least 4.5:1 and every mark of state or place at least 3:1, code on its own ground and selected included; the accent is used once; code has Dark+'s colours; the committed files are what the pinned tokens generate.

Hairline dividers are listed by the generator and held to nothing (1.31:1). That is the kit's design: a divider that only separates is not something a reader has to find. A control's edge is, and is held to 3:1 (3.65:1 on a field, 3.98:1 on the ground).

Selected code is Dark+'s as well, and is held to nothing: under Dark+'s selection colour (`#264f78`) a keyword is 2.88:1, a string 3.21:1 and a comment 2.55:1, exactly as in VS Code. Plain text selected is held, and passes.

Not done: a light (paper) theme, and following the system's light or dark setting.
