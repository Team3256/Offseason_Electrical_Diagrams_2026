/**
 * FRC robot harness — Grayhaven Nerve model
 *
 * Source: team-supplied subsystem description. Anything the description did
 * not state is deliberately LEFT OUT (gauge, length, color, current) rather
 * than guessed, so Nerve reports it as a finding. The findings list is the
 * "additional information required" list.
 *
 * Run:  npm i @grayhaven/nerve @grayhaven/nerve-connectors @grayhaven/nerve-cli
 *       npx nerve validate frc-robot.harness.ts --codes
 *       npx nerve render   frc-robot.harness.ts --view schematic
 *
 * Marked ASSUMPTION: things inferred to make the graph connect. Each one is a
 * question for the team, listed in the accompanying notes.
 */
import {
  branch,
  connector,
  harness,
  isPinEndpoint,
  label,
  splice,
  wire,
  type BranchDef,
  type ConnectorInstance,
  type EndpointInput,
  type PinElectrical,
  type SpliceDef,
  type WireDef,
  type WireEndpoint,
} from '@grayhaven/nerve'
import { definePart } from '@grayhaven/nerve-connectors'

// ─────────────────────────────────────────────────────────────────────────
// Parts (all unverified: no datasheet data was supplied)
// ─────────────────────────────────────────────────────────────────────────
const prov = { verification: 'unverified' as const, source: 'Team-supplied description' }
const dev = (mpn: string, pinCount: number, description: string) =>
  definePart({ mpn, pinCount, description, provenance: prov })

const KrakenX60 = dev('CTRE-KRAKEN-X60', 4, 'Kraken X60: V+/V- studs, CAN-H/CAN-L studs')
const KrakenX44 = dev('CTRE-KRAKEN-X44', 4, 'Kraken X44 (ASSUMPTION: same stud layout as X60)')
const CANcoder = dev('CTRE-CANCODER', 4, 'CANcoder with pigtails: 20AWG power, 2x 22AWG CAN pairs')
const Pigeon = dev('CTRE-PIGEON-2', 4, 'Pigeon IMU: power + CAN')
const CANrange = dev('CTRE-CANRANGE', 4, 'CANrange: power + CAN')
const CANivore = dev('CTRE-CANIVORE', 3, 'CANivore: CAN-H, CAN-L, USB to roboRIO')
const RoboRIO = dev('NI-ROBORIO', 7, 'roboRIO: power, CAN, 1x Ethernet, USB-A')
const Radio = dev('ROBOT-RADIO', 5, 'Robot radio: power + Rio/AUX1/AUX2 Ethernet')
const PDP = dev('CTRE-PDP-2.0', 28, 'PDP 2.0: 24 channels, battery in, common ground')
const MPM = dev('MINI-POWER-MODULE', 14, 'Mini Power Module: 12V in + 6 low-current outputs')
const Mito = dev('MITOCANDRIA', 8, 'Mitocandria: 12V in, CAN, 2x USB-C 5V out')
const OrangePi = dev('ORANGE-PI', 4, 'Orange Pi: Ethernet, USB-C power, USB (cameras)')
const Camera = dev('USB-CAMERA', 1, 'USB camera')
const Limelight = dev('LIMELIGHT-4', 3, 'Limelight 4: power + Ethernet')
const MainBreaker = dev('MAIN-BREAKER', 2, 'Main circuit breaker')
const Battery = dev('BATTERY', 2, 'Robot battery (ASSUMPTION: not in description)')

// ─────────────────────────────────────────────────────────────────────────
// Accumulators
// ─────────────────────────────────────────────────────────────────────────
const connectors: ConnectorInstance[] = []
const wires: WireDef[] = []
const splices: SpliceDef[] = []
const add = (c: ConnectorInstance) => (connectors.push(c), c)

// Every wire is tagged with the section it belongs to; see "Views" at the bottom.
let tag = 'power' // power | network | swerve-bus | swerve-FL.. | ss-rio | ss-intake ..
const tagOf = new Map<string, string>()
const push = (...ws: WireDef[]) => {
  for (const w of ws) {
    wires.push(w)
    tagOf.set(w.id, tag)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CAN helpers
// ─────────────────────────────────────────────────────────────────────────
type Bus = 'CAN_RIO' | 'CAN_IVORE'
// Nerve identifies a CAN bus by its signal-name prefix (e.g. RIO_CAN_H / IVORE_CAN_H).
const canSig = (bus: Bus, half: 'H' | 'L') => `${bus === 'CAN_RIO' ? 'RIO' : 'IVORE'}_CAN_${half}`
const canElec = (bus: Bus, polarity: 'positive' | 'negative', term?: number): PinElectrical => ({
  role: 'bidirectional',
  protocol: 'CAN',
  differential: { pair: bus, polarity },
  ...(term ? { terminationOhms: term } : {}),
  // roboRIO bus is classic 1 Mbit/s CAN. CANivore bus rate was not supplied.
  ...(bus === 'CAN_RIO' ? { bitRateKbps: 1000 } : {}),
})

type Ep = { h: EndpointInput; l: EndpointInput }
const linkCount: Record<string, number> = {}
const canLink = (bus: Bus, a: Ep, b: Ep, note: string) => {
  const i = String((linkCount[bus] = (linkCount[bus] ?? 0) + 1)).padStart(2, '0')
  const common = { gauge: '22AWG', twistGroup: `${bus}-TP${i}`, notes: note } as const
  push(
    wire(`${bus}-H${i}`, a.h, b.h, { ...common, signal: canSig(bus, 'H'), color: 'yellow' }),
    wire(`${bus}-L${i}`, a.l, b.l, { ...common, signal: canSig(bus, 'L'), color: 'green' }),
  )
}
const canEp = (c: ConnectorInstance, h = 3, l = 4): Ep => ({ h: c.pin(h), l: c.pin(l) })

// ─────────────────────────────────────────────────────────────────────────
// Power backbone: battery -> main breaker -> PDP
// ─────────────────────────────────────────────────────────────────────────
const bat = add(connector('BAT', Battery, { pins: { 1: 'BAT_POS', 2: 'GND' } }))
const mcb = add(connector('MCB', MainBreaker, { pins: { 1: 'BAT_POS', 2: 'PWR_MAIN' } }))

// PDP pins: 1-24 = channels 0-23, 25 = battery in, 26 = common ground,
// 27/28 = MPM feeds (ASSUMPTION: no channel is left for them; see notes).
const pdpPins: Record<number, string> = { 25: 'PWR_MAIN', 26: 'GND', 27: 'PWR_12V_MPM1_IN', 28: 'PWR_12V_MPM2_IN' }
const chName = (ch: number) => `PWR_12V_CH${String(ch).padStart(2, '0')}`
for (let ch = 0; ch < 24; ch++) pdpPins[ch + 1] = chName(ch)
const pdp = add(connector('PDP', PDP, { pins: pdpPins }))
const PDP_GND = 26

push(
  wire('PWR-BAT-MCB', bat.pin(1), mcb.pin(1), { signal: 'BAT_POS', color: 'red', notes: 'Battery + to main breaker' }),
  wire('PWR-MCB-PDP', mcb.pin(2), pdp.pin(25), { signal: 'PWR_MAIN', color: 'red', notes: 'Main breaker to PDP input' }),
  wire('GND-BAT-PDP', bat.pin(2), pdp.pin(PDP_GND), { signal: 'GND', color: 'black', notes: 'PDP ground to battery -' }),
)

let nextCh = 0
const allocCh = (): number => nextCh++ // channels are assigned in build order (ASSUMPTION)

// A load fed from a PDP channel with a separate return to the PDP ground bus.
const pdpFeed = (id: string, ch: number, pos: EndpointInput, neg: EndpointInput, extra: object = {}) => {
  push(
    wire(`PWR-${id}-P`, pdp.pin(ch + 1), pos, { signal: chName(ch), color: 'red', ...extra }),
    wire(`GND-${id}-N`, neg, pdp.pin(PDP_GND), { signal: 'GND', color: 'black', ...extra }),
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Motors (X60 / X44). Pins: 1 V+, 2 V-, 3 CAN_H, 4 CAN_L
// Ring terminals: #6 on power studs (10AWG), #4 on CAN studs (2 wires each).
// ─────────────────────────────────────────────────────────────────────────
const motor = (ref: string, kind: 'X60' | 'X44', bus: Bus, term?: number) => {
  const ch = allocCh()
  const m = add(
    connector(ref, kind === 'X60' ? KrakenX60 : KrakenX44, {
      pins: { 1: chName(ch), 2: 'GND', 3: canSig(bus, 'H'), 4: canSig(bus, 'L') },
      terminals: { 1: 'RING-#6', 2: 'RING-#6', 3: 'RING-#4', 4: 'RING-#4' },
      electrical: { 3: canElec(bus, 'positive', term), 4: canElec(bus, 'negative', term) },
    }),
  )
  pdpFeed(ref, ch, m.pin(1), m.pin(2), { gauge: '10AWG' })
  return m
}

// ─────────────────────────────────────────────────────────────────────────
// Mini Power Modules (ASSUMPTION: fill order MPM1 = CANcoders+Pigeon+Limelight,
// MPM2 = CANranges). Each output k has V+ (pin 2k-1) and GND (pin 2k).
// ─────────────────────────────────────────────────────────────────────────
const MPM_USED = { 1: 6, 2: 2 } as const // outputs actually used (ASSUMPTION: allocation order)
const mpmPins = (n: 1 | 2): Record<number, string> => {
  const p: Record<number, string> = { 13: `PWR_12V_MPM${n}_IN`, 14: 'GND' }
  for (let k = 1; k <= MPM_USED[n]; k++) {
    p[2 * k - 1] = `PWR_12V_MPM${n}_O${k}`
    p[2 * k] = 'GND'
  }
  return p
}
const mpm1 = add(connector('MPM1', MPM, { pins: mpmPins(1) }))
const mpm2 = add(connector('MPM2', MPM, { pins: mpmPins(2) }))
push(
  wire('PWR-PDP-MPM1', pdp.pin(27), mpm1.pin(13), { signal: 'PWR_12V_MPM1_IN', color: 'red', notes: 'UNRESOLVED: PDP channel not identified' }),
  wire('GND-MPM1-PDP', mpm1.pin(14), pdp.pin(PDP_GND), { signal: 'GND', color: 'black' }),
  wire('PWR-PDP-MPM2', pdp.pin(28), mpm2.pin(13), { signal: 'PWR_12V_MPM2_IN', color: 'red', notes: 'UNRESOLVED: PDP channel not identified' }),
  wire('GND-MPM2-PDP', mpm2.pin(14), pdp.pin(PDP_GND), { signal: 'GND', color: 'black' }),
)
const mpmPort = { 1: 1, 2: 1 } as Record<1 | 2, number>
const takeMpm = (n: 1 | 2) => ({ n, k: mpmPort[n]++ })

/** Wire a 12V load to an MPM output. `viaSplice` = 20AWG pigtail spliced to MPM leads. */
const mpmFeed = (
  id: string,
  port: { n: 1 | 2; k: number },
  posPin: EndpointInput,
  negPin: EndpointInput,
  opts: { splice?: boolean; gauge?: string; branch?: string; spliceIds?: [string, string] },
) => {
  const m = port.n === 1 ? mpm1 : mpm2
  const sig = `PWR_12V_MPM${port.n}_O${port.k}`
  const g = opts.gauge ? { gauge: opts.gauge } : {}
  if (opts.splice) {
    const sp = splice(opts.spliceIds?.[0] ?? `SP-${id}-PWR`, { type: 'crimp', part: 'M81824/1-1', branch: opts.branch, notes: `${id}: 20AWG pigtail V+ to MPM${port.n} output ${port.k} lead` })
    const sn = splice(opts.spliceIds?.[1] ?? `SP-${id}-GND`, { type: 'crimp', part: 'M81824/1-1', branch: opts.branch, notes: `${id}: 20AWG pigtail GND to MPM${port.n} output ${port.k} lead` })
    splices.push(sp, sn)
    push(
      wire(`PWR-${id}-MPM`, m.pin(2 * port.k - 1), sp, { signal: sig, color: 'red', notes: 'MPM output lead (gauge not supplied)' }),
      wire(`PWR-${id}`, sp, posPin, { signal: sig, color: 'red', ...g }),
      wire(`GND-${id}-MPM`, m.pin(2 * port.k), sn, { signal: 'GND', color: 'black', notes: 'MPM output lead (gauge not supplied)' }),
      wire(`GND-${id}`, sn, negPin, { signal: 'GND', color: 'black', ...g }),
    )
  } else {
    push(
      wire(`PWR-${id}`, m.pin(2 * port.k - 1), posPin, { signal: sig, color: 'red', ...g }),
      wire(`GND-${id}`, negPin, m.pin(2 * port.k), { signal: 'GND', color: 'black', ...g }),
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CAN bus A: CANivore  (ASSUMPTION: swerve + Pigeon live on the CANivore)
//   CANIVORE -> PIGEON -> FL -> FR -> BL -> BR   (module order assumed)
//   Within each module: drive X60 -> CANcoder -> steer X60
// ─────────────────────────────────────────────────────────────────────────
tag = 'swerve-bus'
const canivore = add(
  connector('CANIVORE', CANivore, {
    pins: { 1: canSig('CAN_IVORE', 'H'), 2: canSig('CAN_IVORE', 'L'), 3: 'USB_CANIVORE' },
    // ASSUMPTION: CANivore end termination is switched on
    electrical: { 1: canElec('CAN_IVORE', 'positive', 120), 2: canElec('CAN_IVORE', 'negative', 120) },
  }),
)

const pigeon = add(
  connector('PIGEON', Pigeon, {
    pins: { 1: 'PWR_12V_MPM1_O5', 2: 'GND', 3: canSig('CAN_IVORE', 'H'), 4: canSig('CAN_IVORE', 'L') },
    electrical: { 3: canElec('CAN_IVORE', 'positive'), 4: canElec('CAN_IVORE', 'negative') },
  }),
)

const modules = ['FL', 'FR', 'BL', 'BR'] as const
let prev: Ep = canEp(canivore, 1, 2)
canLink('CAN_IVORE', prev, canEp(pigeon), 'CANivore to Pigeon')
prev = canEp(pigeon)

const mpm1Ports: Record<string, { n: 1 | 2; k: number }> = {}
modules.forEach((m, idx) => {
  tag = `swerve-${m}`
  // Drive motor first, then steer, so PDP channel order is stable.
  const drv = motor(`SW-${m}-DRV`, 'X60', 'CAN_IVORE')
  const str = motor(`SW-${m}-STR`, 'X60', 'CAN_IVORE', idx === modules.length - 1 ? 120 : undefined) // ASSUMPTION: BR steer is bus end
  const port = takeMpm(1)
  mpm1Ports[m] = port
  const cc = add(
    connector(`SW-${m}-CC`, CANcoder, {
      pins: { 1: `PWR_12V_MPM1_O${port.k}`, 2: 'GND', 3: canSig('CAN_IVORE', 'H'), 4: canSig('CAN_IVORE', 'L') },
      electrical: { 3: canElec('CAN_IVORE', 'positive'), 4: canElec('CAN_IVORE', 'negative') },
    }),
  )
  mpmFeed(`SW-${m}-CC`, port, cc.pin(1), cc.pin(2), { splice: true, gauge: '20AWG', branch: `SW-${m}`, spliceIds: [`${m}5`, `${m}6`] })

  // Four M81824/1-1 splices join the two CANcoder pigtail pairs to the motor leads.
  // Ids are kept short (e.g. FL1) so they stay legible on a drawing rail:
  //   <m>1/<m>2 = pair 1 (drive side) H/L,  <m>3/<m>4 = pair 2 (steer side) H/L,
  //   <m>5/<m>6 = CANcoder power +/- to the MPM leads.
  const mk = (n: number, what: string) => {
    const sp = splice(`${m}${n}`, { type: 'crimp', part: 'M81824/1-1', branch: `SW-${m}`, notes: `Swerve ${m}: ${what}` })
    splices.push(sp)
    return sp
  }
  const a: Ep = { h: mk(1, 'CAN-H, pigtail pair 1 to drive-motor lead'), l: mk(2, 'CAN-L, pigtail pair 1 to drive-motor lead') }
  const b: Ep = { h: mk(3, 'CAN-H, pigtail pair 2 to steer-motor lead'), l: mk(4, 'CAN-L, pigtail pair 2 to steer-motor lead') }

  canLink('CAN_IVORE', prev, canEp(drv), `to ${m} drive motor`)
  canLink('CAN_IVORE', canEp(drv), a, `${m} drive motor to CANcoder splice A`)
  canLink('CAN_IVORE', a, canEp(cc), `${m} CANcoder pigtail pair 1`)
  canLink('CAN_IVORE', canEp(cc), b, `${m} CANcoder pigtail pair 2`)
  canLink('CAN_IVORE', b, canEp(str), `${m} CANcoder splice B to steer motor`)
  prev = canEp(str)
})

// Pigeon power (MPM1 output 5)
tag = 'swerve-bus'
const pigeonPort = takeMpm(1)
mpmFeed('PIGEON', pigeonPort, pigeon.pin(1), pigeon.pin(2), { splice: false })

// ─────────────────────────────────────────────────────────────────────────
// roboRIO, radio, Mitocandria, coprocessors
// ─────────────────────────────────────────────────────────────────────────
tag = 'power'
const rioCh = allocCh()
const radioCh = allocCh()
const mitoCh = allocCh()

const rio = add(
  connector('RIO', RoboRIO, {
    pins: { 1: chName(rioCh), 2: 'GND', 3: canSig('CAN_RIO', 'H'), 4: canSig('CAN_RIO', 'L'), 5: 'ETH_RADIO', 6: 'USB_CANIVORE', 7: 'ETH_LL4' },
    // ASSUMPTION: roboRIO built-in CAN termination is enabled
    electrical: { 3: canElec('CAN_RIO', 'positive', 120), 4: canElec('CAN_RIO', 'negative', 120) },
  }),
)
pdpFeed('RIO', rioCh, rio.pin(1), rio.pin(2))

const radio = add(
  connector('RADIO', Radio, {
    pins: { 1: chName(radioCh), 2: 'GND', 3: 'ETH_RADIO', 4: 'ETH_OPI1', 5: 'ETH_OPI2' },
    terminals: { 1: 'FERRULE-20AWG', 2: 'FERRULE-20AWG' },
  }),
)
pdpFeed('RADIO', radioCh, radio.pin(1), radio.pin(2), { gauge: '20AWG' })

const mito = add(
  connector('MITO', Mito, {
    pins: { 1: chName(mitoCh), 2: 'GND', 3: canSig('CAN_RIO', 'H'), 4: canSig('CAN_RIO', 'L'), 5: 'USBC1_5V', 6: 'USBC1_GND', 7: 'USBC2_5V', 8: 'USBC2_GND' },
    electrical: { 3: canElec('CAN_RIO', 'positive'), 4: canElec('CAN_RIO', 'negative') },
  }),
)
pdpFeed('MITO', mitoCh, mito.pin(1), mito.pin(2))

tag = 'network'
push(wire('USB-RIO-CANIVORE', rio.pin(6), canivore.pin(3), { signal: 'USB_CANIVORE', notes: 'USB-A, COTS cable' }))
push(wire('ETH-RIO-RADIO', rio.pin(5), radio.pin(3), { signal: 'ETH_RADIO', notes: 'Ethernet, COTS cable' }))

// Orange Pis + cameras. ASSUMPTION: CAM1 -> OPI1, CAM2 -> OPI2.
;([1, 2] as const).forEach((n) => {
  const opi = add(connector(`OPI${n}`, OrangePi, { pins: { 1: `ETH_OPI${n}`, 2: `USBC${n}_5V`, 3: `USBC${n}_GND`, 4: `USB_CAM${n}` } }))
  const cam = add(connector(`CAM${n}`, Camera, { pins: { 1: `USB_CAM${n}` } }))
  push(
    wire(`ETH-RADIO-OPI${n}`, radio.pin(3 + n), opi.pin(1), { signal: `ETH_OPI${n}`, notes: `Ethernet, radio AUX ${n}, COTS cable` }),
    wire(`USBC-MITO-OPI${n}-5V`, mito.pin(n === 1 ? 5 : 7), opi.pin(2), { signal: `USBC${n}_5V`, color: 'red', notes: 'USB-C power, COTS cable' }),
    wire(`USBC-MITO-OPI${n}-GND`, mito.pin(n === 1 ? 6 : 8), opi.pin(3), { signal: `USBC${n}_GND`, color: 'black', notes: 'USB-C power, COTS cable' }),
    wire(`USB-CAM${n}-OPI${n}`, cam.pin(1), opi.pin(4), { signal: `USB_CAM${n}`, notes: 'USB camera cable' }),
  )
})

// Limelight 4: power from MPM1 output 6, Ethernet "to roboRIO" as described.
const llPort = takeMpm(1)
const ll = add(connector('LL4', Limelight, { pins: { 1: `PWR_12V_MPM1_O${llPort.k}`, 2: 'GND', 3: 'ETH_LL4' } }))
mpmFeed('LL4', llPort, ll.pin(1), ll.pin(2), { splice: false, gauge: '20AWG' })
push(
  wire('ETH-LL4-RIO', ll.pin(3), rio.pin(7), {
    signal: 'ETH_LL4',
    notes: 'UNRESOLVED: roboRIO has one Ethernet port (already used by radio); pin 7 is a placeholder',
  }),
)

// ─────────────────────────────────────────────────────────────────────────
// CAN bus B: roboRIO  (ASSUMPTION on order)
//   RIO -> MITO -> INTAKE(4) -> INDEXER(2) -> FEEDER(2 motors, 2 CANrange) -> SHOOTER(4) -> HOOD
// ─────────────────────────────────────────────────────────────────────────
tag = 'ss-rio'
let rprev: Ep = canEp(rio)
const chain = (c: ConnectorInstance, note: string) => {
  canLink('CAN_RIO', rprev, canEp(c), note)
  rprev = canEp(c)
}
chain(mito, 'roboRIO to Mitocandria')

tag = 'ss-intake'

;(['A', 'B'] as const).forEach((s) => chain(motor(`INTAKE-X60-${s}`, 'X60', 'CAN_RIO'), `Intake X60 ${s}`))
;(['A', 'B'] as const).forEach((s) => chain(motor(`INTAKE-X44-${s}`, 'X44', 'CAN_RIO'), `Intake X44 ${s}`))
tag = 'ss-indexer'
;(['A', 'B'] as const).forEach((s) => chain(motor(`INDEXER-X60-${s}`, 'X60', 'CAN_RIO'), `Indexer X60 ${s}`))
tag = 'ss-feeder'
;(['A', 'B'] as const).forEach((s) => chain(motor(`FEEDER-X60-${s}`, 'X60', 'CAN_RIO'), `Feeder X60 ${s}`))

;([1, 2] as const).forEach((n) => {
  const port = takeMpm(2)
  const cr = add(
    connector(`FEEDER-RANGE${n}`, CANrange, {
      pins: { 1: `PWR_12V_MPM2_O${port.k}`, 2: 'GND', 3: canSig('CAN_RIO', 'H'), 4: canSig('CAN_RIO', 'L') },
      electrical: { 3: canElec('CAN_RIO', 'positive'), 4: canElec('CAN_RIO', 'negative') },
    }),
  )
  mpmFeed(`FEEDER-RANGE${n}`, port, cr.pin(1), cr.pin(2), { splice: false, gauge: '20AWG' })
  chain(cr, `Feeder CANrange ${n}`)
})

tag = 'ss-shooter'
;(['A', 'B', 'C', 'D'] as const).forEach((s) => chain(motor(`SHOOTER-X60-${s}`, 'X60', 'CAN_RIO'), `Shooter X60 ${s}`))
tag = 'ss-hood'
// ASSUMPTION: hood is the last node and carries the second 120 ohm terminator.
chain(motor('HOOD-X44', 'X44', 'CAN_RIO', 120), 'Hood X44 (bus end)')

// ─────────────────────────────────────────────────────────────────────────
// Routing branches  (ASSUMPTION: grouping inferred from subsystem names)
//
// Branches are the physical bundle tree. Declaring them is what lets the
// schematic route wires through orthogonal lanes instead of long curves, and
// it is a prerequisite for the board/formboard views. No lengths are given
// because none were supplied: add `nominalLength` per branch when known.
// ─────────────────────────────────────────────────────────────────────────
const branchIdOf = (ref: string): string => {
  if (ref.startsWith('SW-')) return ref.slice(0, 5) // SW-FL, SW-FR, ...
  const sub = /^(INTAKE|INDEXER|FEEDER|SHOOTER|HOOD)/.exec(ref)?.[1]
  if (sub) return sub
  return ['PIGEON', 'LL4', 'CAM1', 'CAM2'].includes(ref) ? 'SENSORS' : 'PLATE' // ASSUMPTION
}
const BRANCH_ORDER = ['PLATE', 'SENSORS', 'SW-FL', 'SW-FR', 'SW-BL', 'SW-BR', 'INTAKE', 'INDEXER', 'FEEDER', 'SHOOTER', 'HOOD']

// ─────────────────────────────────────────────────────────────────────────
// Views
//
//   (default)               the real design: validate, review, release from this.
//                           (a full-robot render is a hairball; use a section view to draw)
//   NERVE_VIEW=<section>    one section, for drawing only. Sections:
//       power  network  swerve-bus  swerve-FL swerve-FR swerve-BL swerve-BR
//       ss-rio  ss-intake  ss-indexer  ss-feeder  ss-shooter  ss-hood
//     A prefix selects a group: `swerve` (all four modules), `ss` (mechanisms).
//
// A drawing view keeps the wires of one section, only the pins those wires
// use, and drops the `signal` from CAN wires. Nerve draws any signal that
// appears on 3+ wires as a "▸ NET" flag rather than a line, which is right
// for review but hides a daisy chain. Never validate or release a view.
// ─────────────────────────────────────────────────────────────────────────
declare const process: { env: Record<string, string | undefined> } | undefined
const VIEW = (typeof process !== 'undefined' && process?.env.NERVE_VIEW) || 'all'
const isDesign = VIEW === 'all'

const keptWires = isDesign ? wires : wires.filter((w) => {
      const t = tagOf.get(w.id) ?? ''
      return t === VIEW || t.startsWith(`${VIEW}-`)
    })
const outWires: WireDef[] = isDesign
  ? keptWires
  : keptWires.map((w) => {
      if (!/CAN_[HL]$/.test(w.signal ?? '')) return w
      const { signal: _drop, ...rest } = w
      return rest as WireDef
    })

const usedPins = new Map<string, Set<string>>()
const usedSplices = new Set<string>()
for (const w of keptWires) {
  for (const e of [w.from, w.to] as WireEndpoint[]) {
    if (isPinEndpoint(e)) {
      const set = usedPins.get(e.connector) ?? new Set<string>()
      set.add(e.pin)
      usedPins.set(e.connector, set)
    } else usedSplices.add(e.splice)
  }
}
const pick = <T,>(rec: Readonly<Record<string, T>>, keep: Set<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => keep.has(k)))

const outConnectors = isDesign
  ? connectors
  : connectors
      .filter((c) => usedPins.has(c.ref))
      .map((c) => {
        const keep = usedPins.get(c.ref)!
        return connector(c.ref, c.part, {
          pins: pick(c.pins, keep),
          terminals: pick(c.terminals, keep),
          electrical: pick(c.electrical, keep),
        })
      })
const spliceScope = isDesign ? splices : splices.filter((sp) => usedSplices.has(sp.id))

const branches: BranchDef[] = []
for (const id of BRANCH_ORDER) {
  const path = outConnectors.map((c) => c.ref).filter((r) => branchIdOf(r) === id)
  if (path.length === 0) continue
  const hasPlate = outConnectors.some((c) => branchIdOf(c.ref) === 'PLATE')
  branches.push(branch(id, { path, ...(id !== 'PLATE' && hasPlate ? { parent: 'PLATE' } : {}) }))
}
// Drawing-only: silences HK-DOC-002 on the drawing rails. Real label text is a build decision.
const railLabels = branches.map((b) => label(`RAIL-${b.id}`, { text: b.id, attachTo: b.id }))

// Lane routing (branches) pays off only where splices need a rail to sit on, i.e. the
// swerve modules. Elsewhere plain curves read better, and on the full robot lanes are
// unreadable. The branches carry no lengths yet, so the real design does not declare
// them; add nominalLength and emit them in the design when you want the board and
// formboard views. Override the drawing default with NERVE_LANES=0|1.
const lanes = process?.env.NERVE_LANES ?? (!isDesign && spliceScope.length > 0 ? '1' : '0')
if (lanes !== '1') branches.length = 0
if (branches.length === 0) railLabels.length = 0
// A splice may only name a branch that exists.
const outSplices = lanes === '1' ? spliceScope : spliceScope.map(({ branch: _b, ...rest }) => rest as SpliceDef)

export default harness('frc-robot', {
  revision: 'A',
  units: 'mm',
  metadata: {
    status: 'DRAFT: built from a text description; lengths, routing, and several gauges not yet supplied',
    pdpChannelsUsed: String(nextCh),
    ...(isDesign ? {} : { view: `DRAWING ONLY (${VIEW}) - do not validate or release` }),
  },
  connectors: outConnectors,
  wires: outWires,
  splices: outSplices,
  branches,
  labels: railLabels,
})
