# Offseason Electrical Diagrams 2026

The robot's wiring harness, modeled as code in [Grayhaven Nerve](https://docs.grayhavenindustries.com) and checked into this repo. The harness definition (every connector, wire, and splice) lives in one TypeScript file; everything else — diagrams, findings, BOMs — is generated from it.

This guide gets a new laptop from `git clone` to a working copy of the diagrams.

## Prerequisites

- **Node.js 18 or newer**, with npm (it ships with Node). Check what you have:
  ```bash
  node -v
  npm -v
  ```
  Nothing else to install globally — everything runs through `npx`.

- If you don't have Node.js or Node Package Manager, find instructions to install both [here](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

## Get set up

```bash
git clone https://github.com/Team3256/Offseason_Electrical_Diagrams_2026
cd Offseason_Electrical_Diagrams_2026
npm install
```

That pulls in `@grayhaven/nerve`, `@grayhaven/nerve-connectors`, and `@grayhaven/nerve-cli`, plus everything else pinned in `package-lock.json`.

Confirm it worked:

```bash
npx nerve validate src/main.harness.ts --codes
```

You should see a summary line like:

```
frc-robot rev A — 42 connectors, 164 wires — 39 error(s), 164 warning(s)
```

Don't worry about that error/warning count — see **Reading the findings** below before you assume something's broken.

## Project layout

- **`src/main.harness.ts`** — the harness itself. This is the one file that matters day to day; everything below is generated from it or supports it.
- **`nerve.config.ts`** — project settings: units, which checks are errors vs. warnings, export targets.
- **`render-diagrams.mjs`** — a script (ours, not part of Nerve) that renders the harness as 13 separate per-subsystem diagrams instead of one giant unreadable page, and stitches them into one scrollable sheet.
- **`dist/`** — generated output. Mostly gitignored; `dist/harness.json` is committed as a baseline so `nerve diff` has something to compare future revisions against.
- **`.github/workflows/`** — CI: validates every PR against `HK-*` errors and checks that renders are byte-reproducible.

## Everyday workflow

Run these in two terminals side by side.

### 1. Fast feedback while you edit

```bash
npx nerve dev src/main.harness.ts
```

Watches the file and recompiles in under two seconds per save. Gives you a live findings list and a single schematic view at `http://localhost:4477`. Use this while you're actively changing the harness.

### 2. The readable, per-subsystem diagram sheet

`nerve dev`'s live view draws the *entire* robot on one page, which is unreadable past a few connectors. For an actual picture to look at:

```bash
node render-diagrams.mjs src/main.harness.ts dist/diagrams --watch
```

This writes `dist/diagrams/diagrams.html` — one section per subsystem (power, each swerve module, intake, shooter, etc.), with hover-to-highlight on each wire. `--watch` keeps it updated as you edit, debounced so a burst of saves collapses into one re-render rather than several overlapping ones.

Open `dist/diagrams/diagrams.html` in a browser and just refresh it after each pass completes. This is noticeably slower than `nerve dev` — a full pass takes 15–25 seconds, since it's compiling 13 separate views — so it's for "let me look at the actual picture," not instant keystroke feedback.

Drop `--watch` to run it once and exit:

```bash
node render-diagrams.mjs src/main.harness.ts dist/diagrams
```

### 3. Before you commit

```bash
npx nerve validate src/main.harness.ts --codes
```

This is exactly what CI runs on every PR. If it's clean locally (or only shows findings you already know about), it'll pass.

## Reading the findings

Nerve separates **errors** (block a release) from **warnings** (don't). Almost everything you'll see right now is one of three codes:

| Code | Meaning |
|---|---|
| `HK-MFG-003` | a wire has no gauge (error) |
| `HK-MFG-002` | a wire has no color (error) |
| `HK-MFG-001` | a wire has no length (warning — it just means that wire can't appear on the cut list yet) |

These aren't bugs in the model — they're honest gaps in what we've physically specified so far. As gauges, colors, and lengths get locked in, fill them into the matching `wire(...)` call in `src/main.harness.ts` and the count drops.

To see exactly what a clean report would be resting on — and which part data is still unverified — run:

```bash
npx nerve provenance src/main.harness.ts
```

## Making a change

1. Edit `src/main.harness.ts`, with `nerve dev` running for live feedback.
2. Run `npx nerve validate src/main.harness.ts --codes` and make sure you haven't introduced a *new* error.
3. Regenerate the diagram sheet if you want to see the picture: `node render-diagrams.mjs src/main.harness.ts dist/diagrams`.
4. Commit and open a PR. CI validates it automatically.

## Troubleshooting

- **`nerve: command not found`** — you forgot `npx` in front, or haven't run `npm install` yet.
- **The diagram is one giant page, not split by subsystem** — you ran `npx nerve render ...` directly. That command always draws the whole design in one piece. Use `render-diagrams.mjs` instead; it's what actually renders each subsystem separately and stitches the results together.
- **`render-diagrams.mjs` can't find the harness file** — always pass the path explicitly: `node render-diagrams.mjs src/main.harness.ts dist/diagrams`. It won't guess.
- **A first `nerve dev` or `render-diagrams.mjs` run feels slow** — that's normal, it's compiling from scratch. Subsequent `nerve dev` saves are fast; `render-diagrams.mjs` stays in the 15–25s range per pass since it compiles 13 views each time.

## Learn more

- Docs: https://docs.grayhavenindustries.com
- Browser playground (no install, paste-and-go, good for a quick look or a bug report): https://nerve.grayhavenindustries.com
- Full CLI reference: `npx nerve --help`
