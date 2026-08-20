# NewinMeter Reader — Hardware (PCB v1)

Tiny Wi-Fi optical reader for a Kamstrup OMNIPOWER pulse LED. Replaces the
Arduino Uno + breadboard + Mac serial bridge with one USB-C-powered board that
sits over the meter's pulse LED and POSTs pulses to NewinMeter over HTTPS.

## Architecture

```
Kamstrup pulse LED → LDR (optical) → ESP32-C3 (ADC) → Wi-Fi → HTTPS batch POST → NewinMeter
USB-C 5V → AP2112K-3.3 → 3V3 rail
```

Full design details, verifications and BOM: [`pcb/DESIGN-NOTES.md`](pcb/DESIGN-NOTES.md).

## Key parts

- **MCU:** ESP32-C3-MINI-1 (RISC-V, Wi-Fi/BLE, native USB-Serial/JTAG — no USB-UART chip)
- **Regulator:** AP2112K-3.3 (SOT-23-5, 600mA)
- **Sensor:** generic 5mm LDR (proven); TEPT4400 phototransistor footprint reserved (DNP)
- **USB:** USB-C 16P USB2.0, sink-only (2×5.1k CC), USBLC6-2SC6 ESD

## ESP32-C3 pin assignments

| Signal           | Pin             | Function                     |
| ---------------- | --------------- | ---------------------------- |
| LDR / ADC        | GPIO4           | ADC1_CH4 (Wi-Fi-safe ADC1)   |
| Status LED       | GPIO10          | active-high, non-strapping   |
| USB D− / D+      | GPIO18 / GPIO19 | native USB                   |
| BOOT             | GPIO9           | download-mode strap (button) |
| RESET            | EN              | RC delay 10k/1µF + button    |
| Straps held high | GPIO2, GPIO8    | 10k pull-ups                 |
| Serial fallback  | GPIO21/20       | U0TXD/U0RXD test pads        |

## Optical divider (FLIPPED vs Arduino)

```
3V3 ── LDR ──┬── GPIO4
         Q1(DNP)│── 0.1µF ── GND
             R1 10k ── GND
```

Light ↑ → node V ↑ (pulse = voltage spike). Kept in ADC linear range.
0.1µF filter: τ ≤ 1ms vs 30ms Kamstrup pulse — no smear. Recalibrate thresholds on bench.

## Power

USB-C 5V → AP2112K-3.3. Caps: 1µF+10µF in, 1µF out, 10µF+0.1µF at module. See DESIGN-NOTES thermal analysis (copper pour under LDO required).

## PCB

- ~27 × 30 mm, 2-layer, 1.6mm, bottom GND pour (cleared under antenna).
- ESP32 antenna overhangs top edge, **15mm keep-out all directions** (no copper/parts/enclosure metal).
- USB-C on one side edge; LDR on bottom edge facing meter through enclosure aperture.

## Programming

Native USB-C → ESP32-C3 USB-Serial/JTAG. Flash directly (esptool / esp-idf / arduino-esp32).
Recovery: hold BOOT (GPIO9), tap RESET (EN), release BOOT → download mode.
UART fallback available on GPIO20/21 test pads.

## Status LED (placeholder meaning)

_TBD in firmware:_ boot / Wi-Fi provisioning / connected / error. Update once firmware defined.

## Manufacturing notes

Target JLCPCB/PCBWay, 2-layer 1.6mm HASL. LDR + tactiles are THT; rest SMD.
DNP: Q1 (TEPT4400), R11 (GPIO10 pull-down), C8/C9 (USB shunt). See fab outputs in `pcb/fab/` (gitignored, regenerate).

## Known v1 assumptions

- Thresholds recalibrated after assembly (3.3V + flipped divider + ESP32 ADC).
- Antenna performance to be range-tested in final enclosure near meter metal.
- LDO thermal validated on bench under sustained TX; SOT-89-5 fallback noted.
