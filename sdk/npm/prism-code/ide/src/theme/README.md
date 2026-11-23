# The workbench's theme

The workbench opens in **Hologram Dark**, generated from the Hologram brand kit's tokens. Nothing here is written by hand except this file and `fonts.css`.

| File | What it is |
|---|---|
| `hologram-dark.json` | A VS Code colour theme, written by `tools/build-theme.mjs` from the kit's `brand/tokens/hologram-tokens.json` (the `hologram-dark` set) |
| `hologram-tokens.css` | The same tokens as CSS variables, for the strip above the workbench (`model.html`) |
| `fonts/GeistMono-*.woff2`, `fonts/OFL.txt` | Geist Mono and its licence (SIL OFL 1.1), the kit's own files |
| `fonts.css` | The two `@font-face` rules |

The kit, its commit and the BLAKE3 label of each file taken from it are in `tools/brand-pins.json`. To follow a newer kit: change the commit and labels there, run `node tools/build-theme.mjs`, and commit what it writes. A token the theme needs and the kit does not have stops the build; none is invented here.

## What the kit decides and what this folder decides

The kit decides every colour. It has no colours for code, so the mapping in `tools/build-theme.mjs` decides which token colours which part:

- Code is coloured from the text tokens, told apart by weight and slant. One hue is used, the success green, for strings.
- The accent (`#e93b01`) colours one thing: the line over the open tab. The kit allows it once in a view and never as a general highlight.
- Dividers are the kit's hairlines. No shadows.

## Checked

`node tools/theme-test.mjs --fetch` (in CI): every text pair is at least 4.5:1 and every mark of state or place at least 3:1, 53 pairs; the accent is used once; the fonts are the kit's bytes; the committed files are what the pinned tokens generate.

Hairline dividers are listed by the generator and held to nothing: 1.31:1 for a divider, 1.54:1 for a field's edge. That is the kit's design. A divider that only separates is not something a reader has to find, but a field's edge at 1.54:1 is below the 3:1 WCAG asks of a control's boundary.

Not done: a light (paper) theme, and following the system's light or dark setting.
