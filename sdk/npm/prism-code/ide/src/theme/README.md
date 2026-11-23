# The workbench's theme

The workbench opens in **Hologram Dark**: the Hologram brand kit's ground and chrome, with code coloured as VS Code's Dark+ colours it. Nothing here is written by hand except this file.

| File | What it is |
|---|---|
| `hologram-dark.json` | A VS Code colour theme, written by `tools/build-theme.mjs` from the kit's `brand/tokens/hologram-tokens.json` (the `hologram-dark` set) |
| `hologram-tokens.css` | The same tokens as CSS variables, for the strip above the workbench (`model.html`) |

The kit, its commit and the BLAKE3 label of its token file are in `tools/brand-pins.json`. To follow a newer kit: change the commit and label there, run `node tools/build-theme.mjs`, and commit what it writes. A token the theme needs and the kit does not have stops the build; none is invented here.

## What comes from where

- **The kit:** the ground (`#151312`), text, muted text, borders, the bars, lists, menus, fields, buttons, and the colours of errors and warnings.
- **VS Code's Dark+:** every colour of code, for LexLean and for any other language, and the colour of plain text in the editor (`#d4d4d4`). The kit has no colours for code, and the owner asked that code read as it does in VS Code. The values are in `tools/build-theme.mjs` (`DARK_PLUS`).
- **VS Code itself, untouched:** the editor's font and its size, the terminal's sixteen colours, bracket colours.
- **The accent** (`#e93b01`) colours one thing: the line over the open tab. The kit allows it once in a view and never as a general highlight.
- Dividers are the kit's hairlines. No shadows.

## Checked

`node tools/theme-test.mjs --fetch` (in CI): every text pair is at least 4.5:1 and every mark of state or place at least 3:1, 64 pairs, code on the kit's ground included; the accent is used once; code has Dark+'s colours; the committed files are what the pinned tokens generate.

Hairline dividers are listed by the generator and held to nothing: 1.31:1 for a divider, 1.54:1 for a field's edge. That is the kit's design. A divider that only separates is not something a reader has to find, but a field's edge at 1.54:1 is below the 3:1 WCAG asks of a control's boundary.

Not done: a light (paper) theme, and following the system's light or dark setting.
