# NewinMeter Reader v1 — Schematic Design Notes

Frozen architecture (Phase 1) + Phase 2 verifications. This is the connection review
artifact. Netlist below is what the `.kicad_sch` implements; ERC runs against it.

## Component list (BOM)

| Ref      | Part                         | Package   | Populated | Notes                                              |
| -------- | ---------------------------- | --------- | --------- | -------------------------------------------------- |
| U1       | ESP32-C3-MINI-1              | module    | Y         | MCU + Wi-Fi, native USB-JTAG                       |
| U2       | AP2112K-3.3                  | SOT-23-5  | Y         | 3.3V 600mA LDO                                     |
| U3       | USBLC6-2SC6                  | SOT-23-6  | Y         | USB ESD array                                      |
| J1       | USB-C receptacle, USB2.0 16P | SMD       | Y         | 5V in + native USB data                            |
| LDR1     | GL5528 / generic 5mm LDR     | THT 5mm   | Y         | primary optical sensor                             |
| Q1       | TEPT4400 phototransistor     | THT 3mm   | **DNP**   | alt sensor, shares ADC node                        |
| R1       | 10k                          | 0402      | Y         | divider bottom leg → GND                           |
| R2,R3    | 5.1k                         | 0402      | Y         | CC1/CC2 Rd (sink)                                  |
| R4       | 10k                          | 0402      | Y         | EN pull-up                                         |
| R5       | 10k                          | 0402      | Y         | GPIO8 strap pull-up (boot=1)                       |
| R6       | 10k                          | 0402      | Y         | GPIO9 strap pull-up (boot=1)                       |
| R7       | 10k                          | 0402      | Y         | GPIO2 strap pull-up (anti-glitch, Espressif rec)   |
| R8       | 1k                           | 0402      | Y         | status LED series                                  |
| R9,R10   | 22R                          | 0402      | Y         | USB D+/D- series (Espressif rec)                   |
| R11      | 10k                          | 0402      | **DNP**   | GPIO10 pull-down, boot-glitch suppression          |
| C1       | 1µF                          | 0402      | Y         | LDO input                                          |
| C2       | 10µF                         | 0603      | Y         | VBUS/LDO input bulk                                |
| C3       | 1µF                          | 0402      | Y         | LDO output                                         |
| C4       | 10µF                         | 0603      | Y         | module 3V3 bulk (Espressif rec)                    |
| C5       | 0.1µF                        | 0402      | Y         | module 3V3 decoupling (Espressif rec)              |
| C6       | 1µF                          | 0402      | Y         | EN RC delay cap                                    |
| C7       | 0.1µF                        | 0402      | Y         | ADC node filter (see RC analysis)                  |
| C8,C9    | 47pF                         | 0402      | **DNP**   | USB D+/D- shunt-to-GND (Espressif reserve)         |
| D1       | LED (green)                  | 0603      | Y         | status                                             |
| SW1      | tactile SPST                 | SMD 2-pin | Y         | BOOT (GPIO9→GND)                                   |
| SW2      | tactile SPST                 | SMD 2-pin | Y         | RESET (EN→GND)                                     |
| TP1..TP5 | test pads                    | 1mm pad   | Y         | 3V3, GND, U0TXD(GPIO21), U0RXD(GPIO20), ADC(GPIO4) |

30 populated parts, 4 DNP (C8, C9, Q1, R11). Small, no feature creep.

## Nets / connections

**VBUS (5V)**

- J1 VBUS (A4/B4/A9/B9) → U3.5 (Vbus) → U2.1 (VIN) → C1+, C2+
- C1, C2 other end → GND

**+3V3**

- U2.5 (VOUT) → C3+, C4+, C5+ → U1 3V3 pin
- → R4 (EN pull-up top), R5 (GPIO8 top), R6 (GPIO9 top), R7 (GPIO2 top)
- → LDR1 top leg (divider high side), Q1 collector (DNP)

**GND**

- Common: J1 GND (A1/B1/A12/B12) + shield, U1 GND pads, U2.2, U3.2,
  all cap low sides, R1 bottom, R11(DNP), SW1/SW2 return, D1 cathode side via R8? (no — see LED)

**USB data**

- J1 D+ (A6+B6 tied) → U3 IO (D+ line) → R9 22R → U1 GPIO19 [C8 DNP shunt at chip side]
- J1 D- (A7+B7 tied) → U3 IO (D- line) → R10 22R → U1 GPIO18 [C9 DNP shunt at chip side]

**CC (sink)**

- J1 CC1 (A5) → R2 5.1k → GND
- J1 CC2 (B5) → R3 5.1k → GND

**EN / reset**

- U1 EN ← R4 10k → +3V3; U1 EN → C6 1µF → GND; U1 EN → SW2 → GND; U1 EN → TP(reset)

**BOOT strap (GPIO9)** — no capacitor here (download-mode risk)

- U1 GPIO9 ← R6 10k → +3V3; U1 GPIO9 → SW1 → GND

**Strap GPIO8** — U1 GPIO8 ← R5 10k → +3V3 (must be 1 at boot)
**Strap GPIO2** — U1 GPIO2 ← R7 10k → +3V3 (anti-glitch)

**Optical sensor node (ADC = GPIO4 / ADC1_CH4)** — FLIPPED divider, light↑ = V↑

```
+3V3 ── LDR1 ──┬── GPIO4 (U1)
   (Q1 C→3V3,  │
    E→node,DNP)├── C7 0.1µF ── GND
               │
              R1 10k ── GND
```

**Status LED (GPIO10)** — active-high

- U1 GPIO10 → R8 1k → D1 anode; D1 cathode → GND
- U1 GPIO10 → R11 10k → GND (DNP, glitch suppression)

**Test points** — TP1 +3V3, TP2 GND, TP3 U1 GPIO21 (U0TXD), TP4 U1 GPIO20 (U0RXD), TP5 GPIO4

## Phase 2 verification results

**AP2112K-3.3 thermal / headroom** (θJA 184 °C/W, SOT-23-5)

- 600mA cap vs 340mA BLE peak = 1.76× headroom.
- Avg ~100mA → Pd 0.17W → Tj ≈ 71°C @40°C amb. OK.
- Sustained 290mA TX → Pd 0.49W → Tj ≈ 130°C: only if held continuously (bursty in practice).
  Mitigate with GND/VOUT copper pour. Fallback: AP2112 SOT-89-5 if enclosure heat test fails.

**USB series resistors** — Espressif reserves 22/33R series + shunt caps on D+/D-.
Populated 22R (R9/R10). Shunt caps C8/C9 reserved DNP.

**ADC filter RC vs pulse** — Kamstrup pulse width = 30 ms.

- Node Thevenin R = R_LDR‖10k ≈ 5–10k. C7 0.1µF → τ = 0.5–1 ms, 5τ ≤ 5 ms.
- 30 ms ≫ 5 ms (≥6× margin) → no pulse smear. C7 included.

**GPIO10 boot glitch** — non-strapping, floats briefly pre-firmware → cosmetic LED flicker.
R11 (DNP 10k pull-down) reserved to suppress if wanted.

## Firmware-relevant note

Divider flipped vs old Arduino rig: pulse now a voltage **spike** (was a dip).
Thresholds recalibrated on bench regardless.

## Tooling notes — schematic file generation (KiCad GUI compatibility)

The `.kicad_sch` is produced by a hand-written generator (not committed — machine-specific
paths), not by hand-typing s-expressions or by the KiCad GUI. Two real defects surfaced during
verification; both are fixed in the delivered file:

**1. File format version stamp.** First draft used `(version 20250114)`, copied from a
KiCad-9-saved reference file consulted during development. That's the KiCad **9** schematic
format. Current KiCad 10.0.5 format is `20260306`. KiCad 10's GUI correctly detected the file
as old-format and attempted an interactive convert-on-load — importantly, the file's actual
symbol/wire content was valid throughout (`kicad-cli sch upgrade` parsed and rewrote it
successfully at every stage), so this was a metadata mismatch, not data corruption. Fixed by
running the file through `kicad-cli sch upgrade --force` (the official, engine-native
conversion path) as the final step of generation; delivered version/generator fields are
`20260306` / `"eeschema"` / `"10.0"`, i.e. genuine current-format output, not a hand-set stamp.

**2. lib_id / lib_symbols name mismatch (the real rendering defect).** Every placed symbol's
`(lib_id "Library:Name")` must match its embedded `lib_symbols` cache entry's stored name
_exactly_. The generator embedded cache entries under their bare source-library name (e.g.
`"R"`, `"ESP32-C3-MINI-1"`) but referenced them via qualified `lib_id`s (`"Device:R"`,
`"NewinMeter:ESP32-C3-MINI-1"`) — a mismatch on literally every component in the file.
Consequence: KiCad silently fails to resolve the symbol graphics for a mismatched instance —
no error, nothing in ERC (which is purely coordinate-based and never touches symbol
resolution), the instance's own Reference/Value text often doesn't even render. Confirmed via
isolated reproduction (`Device:R` vs bare `"R"` in a 2-symbol test file: the mismatched one
doesn't render at all, a bare-matching one renders perfectly) and via the real project (U1
ESP32-C3-MINI-1 and J1 USB-C — the two largest/most visually obvious symbols — were completely
absent from PDF/SVG export; smaller ones partially/inconsistently showed only their text).
This is the confirmed root cause of the GUI's blank canvas / "[no schematic loaded]".
**Fixed**: `lib_id` now uses the bare (unqualified) name, matching the cache entries. Verified
by direct visual re-export (all 34 components + labels + power symbols now render correctly)
and by unique Reference-designator count (98 = 34 components + 64 power symbols, all resolve).

**3. Known CLI-only caveat (not a file defect).** `kicad-cli sch erc` run standalone (no GUI,
no fully-loaded project) only resolves a symbol's `instances/path` field correctly when it's
the nil UUID (`00000000-…`); a real UUID — even one correctly registered in the companion
`.kicad_pro`'s `sheets` array, matching genuine KiCad file convention — produces spurious
"pin not connected" errors on ~20 pins standalone. This is specific to the headless CLI ERC
tool's project-context resolution, not the design: **the identical topology, differing only
in that UUID field, verifies ERC-clean (0 errors/0 warnings)**, and `kicad-cli sch export bom`
only enumerates parts correctly with the real (registered) UUID — nil UUID gives an empty BOM.
Real UUID was kept (correct convention, working BOM, matches how genuine KiCad-saved files
look) over the CLI-convenience nil UUID. **Run ERC inside the KiCad GUI once the schematic is
open (Inspect → Electrical Rules Checker) for the authoritative check** — the GUI loads full
project context and should not hit this limitation.

**4. `;;` comments are invalid in KiCad's s-expression format.** The hand-written
`LDR_THT_D5.0mm_P5.08mm.kicad_mod` and `TEPT4400_THT_P2.54mm.kicad_mod` footprints (Phase 2)
used `;;` comment lines for documentation. KiCad's format has no comment syntax at all —
`kicad-cli pcb upgrade` failed to load the board with a parse error at the first such line.
Comments removed; the same documentation lives in each footprint's `descr` field instead.

## Phase 3 — PCB placement notes

Board built the same way as the schematic: a generator script (not committed) extracts real
footprint geometry from the library `.kicad_mod` files, places instances at chosen physical
coordinates, assigns pad nets from the _same_ `POWER_NETS`/`SIGNAL_NETS` tables the schematic
uses (copy-pasted verbatim to avoid drift), and the result is run through `kicad-cli pcb
upgrade --force` for genuine native-format output — same lesson as the schematic: prefer the
real engine over hand-authored trust.

**Placement-only DRC**: 0 courtyard overlaps, 0 genuine component-to-component shorts, after
three iterations of spacing fixes (documented via DRC coordinate cross-referencing against the
placement table). Remaining findings are unrouted ratsnest (expected — no routing yet),
silkscreen text overlap (cosmetic, default library label positions at 0402/0603 scale — a
tidy-up pass before Gerbers), and pad-to-pad "shorting"/"clearance"/"hole_clearance" flags that
trace to the _inherent_ pin/hole pitch of the SOT-23-5, SOT-23-6, and GCT USB4105 packages
themselves (verified by coordinate: each flagged pair is two pins of the _same_ component) —
standard, fab-manufacturable, needs a local DRC rule exception before Gerber generation, not a
placement defect.

Also fixed while building this: the generator initially left every footprint's Reference/Value
silkscreen text at the library's placeholder ("REF\*\*") — real refdes/value text is now written
per instance (two syntaxes needed handling: newer `(property "Reference" ...)` and the older
`(fp_text reference ...)` used by hand-written footprints and the official Espressif one).

## Antenna keepout — verified against primary sources, placement corrected

**Sources** (fetched directly, not from memory): Espressif _ESP32-C3 Hardware Design
Guidelines_ (docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c3/),
Section 1.4.7 "General Principles of PCB Layout for Modules", Figures 19–21; cross-referenced
by the _ESP32-C3-MINI-1 & MINI-1U Datasheet_ v2.2, Section 3.1 (pin layout, Note A) and Section
11.2 ("Module Placement for PCB Design"), which explicitly defers back to the same guideline
section — confirmed there is no separate/different numeric spec in the module datasheet itself.

**Real antenna geometry** (from the official footprint's own pad coordinates, not estimated):
the "Antenna Area" silkscreen marking sits between the module body's local Y −8.5 (physical top
edge) and Y −2.2 (where the GND pin ring, pins 36–48, begins) — a **~6.3mm-deep strip**
spanning the module's local X ±4.8mm (matching the GND ring's own span).

**Compliance check — was not compliant.** At the original placement (center Y=5.5, 3mm
overhang), that antenna-area strip spanned board Y −3.0 to +3.3: **more than half of it
(3.3mm of 6.3mm) still sat on PCB copper substrate**, not "outside the base board" as Fig.
19/20 (✓ positions) call for. Fixed by moving U1 to center Y=2.0: the strip now spans board Y
−6.5 to −0.2, i.e. it clears the board edge entirely with a 0.2mm margin. Overhang increased
3mm → 6.5mm. No other placement changed.

**Fig. 21's "Min15" clearance does not apply to this board as a hard PCB rule.** That figure
is Espressif's explicit fallback ("if the antenna **cannot** extend beyond the board edge, ...
cut off the base board... Fig. 21 shows the suggested clearance area") for boards that notch
the antenna in rather than overhanging it. Ours overhangs (the preferred, ✓-marked
configuration), so that fallback geometry isn't the applicable rule. The separate "15mm in all
directions" figure mentioned right after it is explicitly scoped to **inside the end-product
housing** ("after the base board is placed in the end product... clearance of at least 15mm
recommended in all directions") — an enclosure-CAD constraint, not a PCB copper-keepout
dimension. Applying either 15mm figure as an on-PCB keepout on a 41mm-tall board would
consume close to half the board for no RF benefit the source actually calls for.

**What the real keepout zone protects, and why it's small.** With the antenna fully off-board,
there's almost nothing left on the physical PCB to protect — the zone (`Antenna_Keepout_ESP32C3`,
`hardware/pcb/newinmeter-reader.kicad_pcb`) is a modest residual strip: **X 10.5–21.5mm, Y
0.6–2.0mm** (board coordinates), matching the antenna/GND-ring's real X-extent (not the full
module width — the wider box originally caught the module's own left/right-edge signal pins,
which aren't antenna-related). `tracks`/`vias`/`pads`: not_allowed on both `F.Cu` and `B.Cu`.
`copperpour`: **allowed** — the same guideline section states "sufficient ground copper and
dense ground vias should be placed on the base board near the antenna," so excluding ground
fill here would contradict the source, not follow it. `footprints`: **allowed** — KiCad's
keepout check flags a footprint by full courtyard overlap with no way to exempt "the very
module this zone protects," and U1's own body legitimately spans this strip; real protection
against a foreign part landing here still comes from the pads/tracks/vias restriction.

**DRC**: 0 `items_not_allowed` (zone correctly excludes only the intended objects), 0 courtyard
overlaps. 15 `copper_edge_clearance` flags on U1's own GND-ring pads (now sitting ~0.2mm past
the board edge) are the direct, expected, correct consequence of the overhang fix, not a defect.

## Correction — the 15 copper_edge_clearance flags WERE real, not acceptable

The previous entry was wrong to wave those off. "The antenna may overhang the board" and "a
solder pad may overhang the board" are different claims — the antenna is a trace inside the
module's own internal structure with nothing underneath it to support; a castellated SMT pad
is the actual solder joint connecting module to host board, and needs full copper+substrate
support underneath to be a reliable, manufacturable joint. Landing 0.2mm of a pad's copper past
Edge.Cuts isn't a documented "expected consequence" of anything Espressif recommends — it's an
unmanufacturable pad, full stop.

**Root cause of the mistake**: Y=2.0 was derived from the antenna's _silkscreen-labeled_ area
boundary (local Y −2.2, the GND pin ring's _center_), not from the pads' own physical edges.
A 0.4×0.8mm rect pad centered at Y−2.2 extends to Y−2.6 — 0.4mm further out than the boundary
used.

**Fix, computed from real geometry, not estimated**: parsed all 53 of U1's real pads (size +
rotation) directly from the official footprint file. Northernmost pad edge across the whole
module: **local Y = −2.6mm** (GND ring pads 36–48, and corner pads 50/53 — all 0.4×0.8mm or
0.7×0.7mm rects at Y=−2.2 to −2.25). Board's own copper-edge-clearance rule is 0.5mm, so
`center ≥ 2.6 + 0.5 = 3.1`; used **Y=3.2** for a clean margin rather than the knife-edge
minimum. Verified independently of DRC by computing every pad's board-space bounding box
directly: **0 pads with any copper at Y<0, nearest pad edge sits 0.6mm inside the board edge**
(exceeds the 0.5mm rule). `kicad-cli pcb drc` confirms: 0 `copper_edge_clearance`, 0
`items_not_allowed`.

**Trade-off, honestly stated**: overhang dropped from 6.5mm (the non-compliant position) to
**5.3mm** to get there. Still clearly in "outside the base board" territory — Espressif's own
Fig. 19/20 don't specify a minimum overhang distance, only that the antenna should be beyond
the edge — and ~84% of the labeled antenna area (5.3 of 6.3mm) now clears the board, versus
under half at the original 3mm-overhang position. A notched/stepped board outline (extending
just the antenna-width region further out to preserve more overhang while still supporting the
pads) was considered and rejected in favor of moving the module — a plain rectangular edge is
simpler to manufacture and much easier to design a snug enclosure/mounting-plate interface
around, for a marginal (1.2mm) overhang difference.

## Antenna keepout zone — corrected to not fight Espressif's own ground-fill guidance

The original zone blocked `vias` and `pads` inside the on-board transition strip. Wrong:
Espressif's text says "sufficient ground copper **and dense ground vias** should be placed on
the base board near the antenna" — blocking vias there directly contradicts the source it was
supposedly implementing. Re-derived by explicitly separating three regions the guideline text
actually distinguishes:

- **A. Radiating antenna** (local Y −8.5 to −2.6 → board Y −5.3 to −0.6 at the corrected
  placement): physically off-board. Nothing to write a rule for — no substrate exists there.
- **B. Feed/boundary** (the GND pad ring, board Y 0.6–1.4): U1's own required solder pads.
  Not something to exclude; already protected from _foreign_ parts by ordinary
  footprint-courtyard DRC (separately verified clean).
- **C. Nearby ground/stitching region** (the board area around the module): Espressif
  explicitly wants ground copper and via stitching **here** — left completely unrestricted.

Zone renamed `Antenna_Transition_NoTraces` and now blocks exactly one thing: **routed signal
tracks** through the board-edge transition strip (X 10.0–22.0, Y 0–1.4mm, `F.Cu`+`B.Cu`) —
the one item that could plausibly detune/couple into the antenna without being either physically
absent (region A) or something Espressif wants present (regions B/C). `vias`, `pads`,
`copperpour`, `footprints`: all `allowed`.

## Enclosure clearance — correction

Previous note overstated "plastic is fine" as if enclosure material were categorically
irrelevant. It isn't: Espressif's guidance is explicit that the _housing_ must be considered,
recommends **≥15mm clearance around the antenna inside the end product in all directions**, and
requires **final throughput/range testing** regardless. The plastic-vs-metal distinction is
real (low-dielectric plastic has far less RF impact than metal) but doesn't make the clearance
figure optional.

**Can this compact enclosure realistically hit 15mm on all sides? No, and we should say so
rather than resize the product to force it.** The device is an external add-on that sits
directly against/near the meter housing — 15mm clearance specifically on the meter-facing side
is incompatible with that goal, and hitting 15mm on every side of a board this size would push
the enclosure to roughly 65×75×40mm+, defeating the compact/low-profile intent for no
stated requirement to go that large.

**Realistic plan**: maximize clearance where the compact form factor allows it — the antenna
overhangs the board's _top_ edge, so keep that wall of the enclosure as clearance-generous as
practical (a few mm of plastic there has minimal RF cost) and, more importantly, **keep all
metal hardware (screws, hinges, shielding, metal standoffs) away from that end of the
enclosure entirely**, routing any necessary metal fasteners to the opposite (USB-C) end. The
15mm figure is not achievable end-to-end in this form factor; deliberately deviating from it is
accepted here, **contingent on mandatory bench validation of Wi-Fi range/throughput in the
actual assembled enclosure** before this ships as final. If range proves inadequate,
Espressif's own external-antenna variant (ESP32-C3-MINI-1U, already noted as a Phase 1 fallback)
is the documented escape hatch — not a redesign of this board.

## Phase 4 — routing

**Layer strategy.** +3V3 and +5V route entirely as B.Cu trunks, with a via dropping to F.Cu
at every SMD consumer pad (THT pads — LDR1.1, Q1.1 — excluded, since a through-hole pad already
spans both copper layers natively; a via landing on its own drill is a hole-in-hole
manufacturing conflict, not a real improvement). All signal nets (USB diff pair, ADC, straps,
EN, LED, CC1/CC2, U0TXD/RXD) stay on F.Cu, direct pad-to-pad. GND is two independent filled
zones, one per layer, inset 0.3mm from Edge.Cuts. This keeps the wide-reaching power nets off
the same layer as the local signal routing, which eliminates the majority of crossings in one
move. Vias: 0.6mm pad / 0.3mm drill (board's default net class). Trace widths: 0.20mm (USB
diff pair), 0.25mm (digital signal / ADC), 0.40mm (+3V3), 0.50mm (+5V).

**Generator/tooling bug (silent data loss).** Early in this phase, `kicad-cli pcb upgrade
--force` was silently dropping every routed segment, via, and GND pour zone — the command
printed "Successfully saved" regardless. Root cause: a leftover duplicate closing-paren emit
in the antenna-keepout-zone code (artifact of the earlier antenna-correction edit) closed
`(kicad_pcb` one level early; the CLI's parser stops at the first complete top-level form
instead of erroring on trailing content. Found via a full-file paren-balance check
(`text.count('(')` vs `text.count(')')`, off by exactly one) after isolating it with a series
of minimal reproduction files. Fixed by deleting the stray `)`. **Lesson for any future
generator edit to this file: always verify paren balance before trusting an "upgrade
succeeded" message.**

**DRC methodology.** `kicad-cli pcb drc` must be run with `--refill-zones --save-board` —
without those flags, filled-pour zones are present in the file but never actually computed,
so the connectivity engine treats them as empty and reports large false "unconnected" counts
(68 in one early run) regardless of the zone's declared `(fill yes ...)` settings. With the
flags, that dropped to a genuine number in one step. All DRC numbers below use this flag
combination.

**Root-cause bug: rotated-footprint pad transform.** The hand-derived pad-position math used
to plan routing waypoints assumed KiCad rotates a footprint's stored angle counter-clockwise,
`(x,y) -> (-y,x)` for 90°. The real convention is clockwise, `(x,y) -> (y,-x)`. This silently
placed every pad of U2 (AP2112K-3.3, SOT-23-5) and U3 (USBLC6-2SC6, SOT-23-6) — the only two
rotated (rot=90) parts besides the antenna module (rot=0, unaffected) and J1 (rot=180,
unaffected since a 180° flip is direction-independent) — at the _mirrored_ position. Concretely:
USB_DP's trace was landing on U3's real USB_DM pads and vice versa (a genuine D+/D- swap at the
ESD chip, not routing noise), and U2's +5V/GND/+3V3 vias were aimed at the wrong physical
corner of the regulator footprint entirely. Found by cross-checking DRC's own reported absolute
pad coordinates against hand math once DRC kept reporting geometrically "impossible" crossings.
All U2/U3 waypoints in `route_data.py` were recomputed from the corrected transform and
re-verified against DRC's reported positions.

**Real defect found and fixed: floating AP2112K EN pin.** U2 pin 3 (EN) had no wire in the
schematic and no net in the PCB — confirmed by direct inspection of the schematic file (no wire
endpoint within 1.2mm of the pin's computed position) and independently by DRC (`Pad 3 [<no
net>] of U2`). The AP2112K-3.3 datasheet requires EN to be actively driven; left floating, the
regulator's on/off state is indeterminate. This is a concrete electrical defect, not a routing
artifact, and falls under the standing exception to touch the approved schematic. Fixed with
the smallest possible change: one wire tying EN directly to VIN (pin 1, already +5V) in the
schematic, plus the matching net assignment and a short PCB jumper (dogleg-routed around GND
pin 2's own pad, which sits physically between EN and VIN on the SOT-23-5). Re-ran ERC after
the fix: no new error/warning categories versus the pre-fix baseline (still only the two
already-documented CLI-only artifacts — nil-vs-real-UUID false positives and bare-`lib_id`
library-path warnings).

**Other genuine routing bugs found via DRC and fixed:**

- `LED_CTL`'s trace from R11 to R8 ran in a straight line that passed directly across R11's own
  GND pad (R11 sits physically between its own LED_CTL tap and R8). Dodged around it — matters
  even though R11 is DNP, since the copper is still there.
- `EN` and `GPIO9_BOOT`'s continuation past their own strapping resistor (R4, R6) toward SW2/SW1
  ran in a straight line across that resistor's +3V3 pin-1 pad, for the same reason. Both dodged.
- `GPIO2_STRAP`'s vertical run at X=13.51 passed 0.09mm from U1 pin 15 (unrelated, no net) —
  shifted into the gap between adjacent U1 pads, then jogged back once clear of U1's body.
- `EN`'s turn away from U1 pin 8 originally turned at Y=9.0, 0.1mm from U1 pin 10 directly below
  — moved the turn to Y=8.0 for real clearance.
- A via placed directly on/in a 0.6mm-wide SMD pad (U2 pin 1, U3 pin 5) leaves no room to the
  0.95mm-pitch neighbor pad on a SOT-23-5/6 — DRC-confirmed clearance failure. Both moved
  0.75–1.06mm off-pad with a short F.Cu stub to the real pad, standard practice for via-in-pad
  avoidance on tight-pitch SMD.
- Six GND pads (C1.2, C4.2, SW2.2, R11.2, C7.2, U2.2) were geometrically isolated from the
  GND pour by nearby other-net copper close enough that the pour's own clearance couldn't
  bridge in — given explicit short GND stitch vias rather than relying on the fill finding its
  own way.
- Reference-designator silkscreen text for U2, U3, R11, R6, C3 was sitting on top of copper or
  other silkscreen (library default text position assumes more breathing room than this board
  has) — repositioned via a per-refdes local-frame offset table in the generator.

**Current DRC state** (after all of the above; exact category counts, not summarized as
"clean" per standing instruction): 157 total violations, 3 unconnected items. See the Phase 4
report for the full breakdown and the fine-pitch-component attribution (J1/U1/U2/U3 pad pitch
account for the large majority of `solder_mask_bridge`, `hole_clearance`, and a meaningful share
of `shorting_items`/`clearance` — these are the same class of connector/module-pad-pitch finding
already documented as expected in the antenna-verification phase, not new). A residual set of
genuine hand-routing density issues remains in the strap-resistor row and around the USB-C
connector approach; further reduction is possible but was showing diminishing/oscillating
returns under continued blind coordinate edits by the last few iterations, which is itself a
signal that the remaining polish is better done interactively in the KiCad GUI (visual
drag-to-route avoids these near-miss clearance mistakes far more reliably than hand-typed
coordinates) rather than continued automated text edits.

## Phase 4B — proof-driven routing triage (not approved for manufacturing)

The user rejected Phase 4 as routed/complete and required a different method: every remaining
DRC finding classified with evidence (genuine defect / footprint-internal geometry /
manufacturer-land-pattern consequence / checker artifact / uncertain), proof for the
specific U1-GND, USB-continuity, and GND-zone-bridging questions, and no further "blind
coordinate guessing."

**Tooling built this phase** (`scratchpad/connectivity.py`, `prove.py`, `clearance_check.py`):
a geometric parser reading real pad/track/via/zone-fill geometry straight from the generated
`.kicad_pcb` (not net names, not assumptions), a union-find connectivity prover with
mid-segment T-junction detection, and a deterministic pre-flight clearance checker (segment/via/
pad, oriented-rectangle-aware, not a circular over-approximation) that computes real
surface-to-surface distances before a change is applied, rather than editing then waiting on a
full DRC cycle to find out. This is now the standing verification method for this board;
prefer it (or the KiCad GUI directly) over further hand-coordinate iteration.

**Proven, not assumed, per the user's specific questions:**

- _U1 GND_: every U1 GND pad individually tested for actual zone-fill contact and union-find
  group membership. All 30 are in the single main GND copper group. One (pin 14) doesn't touch
  the pour directly but reaches the group through an explicit stitch trace -- confirmed
  electrically sound either way.
- _USB continuity_: `USB_DP_MCU`, `USB_DP`, `USB_DM_MCU`, `USB_DM` each independently confirmed
  as ONE connected copper group with the correct membership (J1 connector pads -> U3 ESD pads
  -> series resistor -> U1 MCU pad), and R9/R10 proven to bridge the pre-/post-resistor net
  pairs on both sides. D+/D- polarity and topology are correct end-to-end.
- _GND zone bridging_: 27 of 28 GND vias confirmed touching both `GND_pour_top` (F.Cu) and
  `GND_pour_bottom` (B.Cu) fill polygons directly. No isolated GND islands found by union-find
  across the whole net.
- _SW2.2 anomaly_: an earlier via-based stitch tested as zone-touching by a naive point-in-
  polygon check, but DRC's own engine still reported it unconnected. Investigated rather than
  dismissed: the via's center sits inside its own thermal-relief antipad gap, not in literal
  copper -- DRC's engine (which models the actual thermal-spoke geometry) is authoritative over
  the simpler polygon check. Fixed with a direct trace to an already-proven-connected pad
  instead of relying on a new via's spokes.

**Real defects found and fixed this phase** (all proven by the tooling above, not iterate-and-
hope):

- USB_DP and USB_DM were topologically crossing each other near U3/J1 (both nets jogging west
  through the same Y row) -- redesigned as genuinely parallel, non-crossing paths (constant
  offset diagonal off U3's pins, staggered westward jogs, a single unavoidable B.Cu hop for one
  of the four interleaved J1 pads rather than a same-layer bridge that would have crossed the
  other net's pad).
- The +5V and +3V3 B.Cu trunks crossed each other near U3 (a direct +5V-to-+3V3 short) --
  traced through three iterations of the trunk's approach to U3's +5V pin before finding a path
  that stays outside +3V3's own L-shaped copper "wall" in that corner for its entire length.
  This is now documented in-line in `route_data.py` as a worked example of the geometry, since
  the naive "just move it 0.5mm further" fix repeatedly failed and needed the real wall extents
  reasoned through explicitly.
- Roughly a dozen new GND stitch vias (added in the prior phase to fix isolated pads) turned
  out to sit too close to the B.Cu power trunks or to other components' own pads once checked
  against real geometry instead of eyeballed coordinates -- relocated using the deterministic
  checker to confirm each new position before regenerating.
- Discovered and corrected a real modeling gap in the checker itself mid-session: circular
  pad-radius approximation (`max(w,h)/2`) badly overestimated narrow/tall connector pads (J1's
  0.3x1.15mm pads were being treated as 0.575mm-radius circles, a ~2x overestimate of their
  real width), producing false conflicts. Replaced with proper oriented-rectangle geometry,
  which resolved a large fraction of apparent J1-adjacent violations as exactly that --
  false positives from the approximation, not real board defects.

**Current DRC state** (fresh run, `--refill-zones --save-board`): 115 total violations, 1
unconnected pad. Down from 161 at the start of this phase (which was itself down from an
early-phase 173). Full category counts and classification are in the Phase 4B report delivered
to the user. **Not zero** in `shorting_items` (12), `clearance` (31), `tracks_crossing` (7) --
the user's explicit target -- so this is not being represented as routed/complete. Roughly half
of the remaining `clearance`/`shorting_items`/`solder_mask_bridge` count is proven inherent to
U1/U2/U3/J1's real manufacturer pad pitch (SOT-23-5 0.95mm, SOT-23-6 0.95mm, USB-C receptacle
0.5mm) rather than a routing choice; the rest is a genuine remaining punch list, itemized and
handed back to the user rather than glossed over.
