#!/usr/bin/env node
/**
 * Render every section of the FRC harness as a Nerve schematic and stitch them
 * into one scrollable sheet: diagrams.html   (hover a wire to highlight it).
 *
 *   node render-diagrams.mjs <harness-file> [out-dir] [--watch]
 *
 * The 13 section renders run in parallel (each writes to its own subfolder,
 * so there's no conflict) - a full pass is a few seconds, not ~18s serial.
 *
 * --watch keeps running: it re-renders whenever the harness file (or any
 * sibling .ts file, for shared parts/helpers) changes, debounced so a burst
 * of saves only triggers one pass. Ctrl-C to stop.
 *
 * This is a visual-review tool, not the fast edit loop - for that, run
 * `npx nerve dev <file>` alongside it (sub-2s full-design feedback) and
 * reach for this script every so often, or leave --watch running in a
 * second terminal while you work.
 *
 * Section views are DRAWING ONLY (see NERVE_VIEW in the harness file).
 * Validate and release the real design, never a view.
 */
import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const args = process.argv.slice(2).filter((a) => a !== '--watch')
const watchMode = process.argv.includes('--watch')
const file = args[0]
const out = args[1] ?? 'diagrams'

if (!file) {
  console.error('usage: node render-diagrams.mjs <harness-file> [out-dir] [--watch]')
  process.exit(1)
}

const SECTIONS = [
  ['power', 'Power distribution', 'Battery, main breaker, PDP, MPMs; Rio, radio and Mitocandria feeds'],
  ['network', 'Network and coprocessors', 'Ethernet, USB, USB-C, Orange Pis, cameras, Limelight'],
  ['swerve-bus', 'CANivore bus head', 'CANivore, Pigeon, USB to roboRIO'],
  ['swerve-FL', 'Swerve FL', 'drive -> CANcoder -> steer, with power'],
  ['swerve-FR', 'Swerve FR', 'drive -> CANcoder -> steer, with power'],
  ['swerve-BL', 'Swerve BL', 'drive -> CANcoder -> steer, with power'],
  ['swerve-BR', 'Swerve BR', 'drive -> CANcoder -> steer, with power (bus end)'],
  ['ss-rio', 'roboRIO CAN bus head', 'roboRIO to Mitocandria'],
  ['ss-intake', 'Intake', '2x X60, 2x X44'],
  ['ss-indexer', 'Indexer', '2x X60'],
  ['ss-feeder', 'Feeder', '2x X60, 2x CANrange'],
  ['ss-shooter', 'Shooter', '4x X60'],
  ['ss-hood', 'Hood', '1x X44 (bus end)'],
]

// One nerve process per section, ~1-1.5s each of mostly Node/jiti startup -
// run them concurrently instead of one after another (13x ~1.3s serial =~
// 17s; concurrent is bounded by the slowest single section, generally 2-3s).
const renderSection = async ([view, title, blurb]) => {
  const dir = join(out, view)
  mkdirSync(dir, { recursive: true })
  try {
    await execFileAsync('npx', ['nerve', 'render', file, '--view', 'schematic', '--out', dir], {
      env: { ...process.env, NERVE_VIEW: view },
    })
  } catch (err) {
    // A drawing view can't error (it's inert), but keep this loud rather than
    // silently dropping a section if something upstream (e.g. the file
    // itself fails to parse) breaks every call the same way.
    console.error(`[${view}] render failed:\n${err.stderr || err.message}`)
    throw err
  }
  const svg = readFileSync(join(dir, 'schematic.svg'), 'utf8').replace(/<\?xml[^>]*\?>/, '')
  return `<section id="${view}"><h2>${title}<span>${blurb}</span></h2><div class="sheet">${svg}</div></section>`
}

const nav = SECTIONS.map(([v, t]) => `<a href="#${v}">${t}</a>`).join('')

const renderAll = async () => {
  const t0 = Date.now()
  mkdirSync(out, { recursive: true })
  const blocks = await Promise.all(SECTIONS.map(renderSection))
  writeSheet(blocks)
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[${new Date().toLocaleTimeString()}] wrote ${join(out, 'diagrams.html')} (${dt}s)`)
}

function writeSheet(blocks) {
writeFileSync(
  join(out, 'diagrams.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>frc-robot - schematic sections</title>
<style>
  body { margin: 0; background: #e8e6e1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { position: sticky; top: 0; z-index: 2; padding: 8px 14px; font-size: 11px; background: #f1efe9; border-bottom: 1px solid #d4d1ca; }
  header b { text-transform: uppercase; letter-spacing: .04em; color: #555; margin-right: 12px; }
  header a { color: #333; margin-right: 10px; white-space: nowrap; text-decoration: none; }
  header a:hover { text-decoration: underline; }
  section { max-width: 836px; margin: 0 auto; padding: 18px 0 6px; scroll-margin-top: 44px; }
  h2 { font-size: 14px; margin: 0 0 8px; color: #222; }
  h2 span { font-weight: normal; color: #777; font-size: 11px; margin-left: 10px; }
  .sheet { overflow-x: auto; box-shadow: 0 1px 4px rgb(0 0 0 / .12); }
  svg { display: block; max-width: 100%; height: auto; }
  svg text { paint-order: stroke; stroke: #fafafa; stroke-width: 3px; stroke-linejoin: round; }
  svg [data-wire] { transition: opacity 150ms ease-out; }
  .sheet.hover svg [data-wire]:not(.hl) { opacity: .18; }
  .sheet.hover svg path[data-wire].hl, .sheet.hover svg line[data-wire].hl { stroke-width: 3; }
  .note { max-width: 836px; margin: 12px auto 0; font-size: 11px; color: #777; }
</style></head><body>
<header><b>frc-robot - rev A - Grayhaven Nerve</b>${nav}</header>
<p class="note">Drawing views only. Red dashed wires carry an error finding (mostly missing gauge/color); they turn solid as data is supplied. Validate the real design, not these views.</p>
${blocks.join('\n')}
<script>
let active = null;
const clear = () => { if (!active) return; active.classList.remove('hover'); active.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl')); active = null; };
document.addEventListener('pointerover', (e) => {
  const ref = e.target.closest?.('[data-wire]')?.getAttribute('data-wire');
  clear();
  if (!ref) return;
  active = e.target.closest('.sheet');
  active.classList.add('hover');
  active.querySelectorAll('[data-wire="' + CSS.escape(ref) + '"]').forEach((el) => el.classList.add('hl'));
});
</script></body></html>`,
)
}

if (!watchMode) {
  await renderAll()
} else {
  // A render takes several seconds (13 nerve processes). Two things follow:
  // don't start a second one while one is still running (queue a rerun
  // instead, so a flurry of saves collapses to "one more pass when this one
  // finishes" rather than N overlapping passes stepping on the same output
  // directory) - and register the watcher *before* the first render starts,
  // so an edit that lands mid-render is queued rather than missed outright.
  let running = false
  let rerunQueued = false
  const runOnce = async (reason) => {
    if (running) {
      rerunQueued = true
      return
    }
    running = true
    console.log(`[${new Date().toLocaleTimeString()}] ${reason}`)
    await renderAll().catch((err) => console.error(err.message))
    running = false
    if (rerunQueued) {
      rerunQueued = false
      runOnce('queued change, re-rendering...')
    }
  }

  // Debounce: a save can fire several fs events, and a formatter re-save
  // lands a moment later - collapse a burst into one re-render.
  let pending = null
  const schedule = (path) => {
    clearTimeout(pending)
    pending = setTimeout(() => runOnce(`${path} changed, re-rendering...`), 300)
  }

  // Watch the harness file's directory (not just the file) so edits that
  // save-via-rename (common with editors / formatters) aren't missed, and
  // so a sibling file (e.g. shared part definitions) also triggers a pass.
  const watchDir = dirname(file) || '.'
  watch(watchDir, { recursive: true }, (_event, filename) => {
    if (filename && /\.tsx?$/.test(filename)) schedule(filename)
  })
  console.log(`watching ${watchDir}/**/*.ts for changes - ctrl-c to stop`)
  await runOnce('initial render')
}
