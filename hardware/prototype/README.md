# Live optical meter ingestion — prototype

First milestone of NewinMeter's **live** electricity feed. Instead of waiting
for LiveMopay's ~4 batches/day, an optical reader watches the Kamstrup
OMNIPOWER metering LED and streams raw pulse events into NewinMeter in near
real time.

```
Kamstrup LED → LDR → Arduino Uno → USB serial → Mac bridge → HTTPS → NewinMeter
```

Later the Mac bridge is replaced by an ESP32 (Wi-Fi/HTTPS direct). The Mac is a
temporary "dumb network bridge" so the real ingestion architecture can be built
and tested first.

The meter LED is **1000 impulses/kWh**, so **1 pulse = 1 Wh = 0.001 kWh**. The
hardware only reports pulse identity and timing — **all** watts/kWh/tariff/cost/
graph/aggregation logic lives in NewinMeter, and the ingestion tables store
**raw telemetry only** so those calculations can change without reflashing
hardware or rewriting history.

> ⚠️ **This feed is deliberately isolated** from the LiveMopay ledger
> (`energy_rows`, `energy_*_rollups`, `dashboard_summary`). It represents
> consumption LiveMopay will report later; merging now would double-count.
> Reconciliation is intentionally deferred.

---

## 1. Flash the Arduino

Open `arduino/pulse_reader.ino` in the Arduino IDE and upload it to the Uno.
It emits one serial line per pulse at 115200 baud:

```
PULSE,<sequence>,<uptime_ms>,<delta_ms>
PULSE,1,14573,0
PULSE,2,16381,1808
```

The hysteresis detector is already validated against the real meter — don't
change it.

## 2. Create a device key

Every physical device authenticates with its own revocable key
(`nm_dev_…`) — never a Supabase key, LiveMopay credential, or browser session.
Only the SHA-256 hash of the key is stored; the raw key is printed **once**.

The live-meter feature is gated by a per-user permission (`live_meter_enabled`,
like activities). The target user must have it enabled — toggle it from the
admin **Users** table (**Live meter** column) — or both the CLI below and the
ingestion endpoint refuse. It is enabled for the prototype user by migration.

Run from the repo root (uses `.env.local` service-role setup):

```bash
npm run create:meter-device -- --email <newinmeter-user-email> --name "Home meter"
# optional: --pulses-per-kwh 1000
```

It resolves the user, finds their active (connected) LiveMopay connection, and
prints:

```
  Device ID:  <uuid>
  Device key: nm_dev_...
```

> 🔒 **The device key is a secret.** Copy it now — it is never shown again and
> never stored in plaintext. **Do not commit it.**

## 3. Install the Python bridge dependencies

Two Python-only deps (kept out of the Node `package.json`):

```bash
cd hardware/prototype/bridge
pip install -r requirements.txt   # pyserial, requests
```

## 4. Find the serial device (macOS)

```bash
ls /dev/cu.usbmodem*
```

## 5. Configure

```bash
export SERIAL_PORT=/dev/cu.usbmodemXXXX
export NEWINMETER_URL=https://newinmeter.vercel.app/api/live/pulses
export NEWINMETER_DEVICE_KEY=nm_dev_...        # the secret from step 2
# optional:
# export DEVICE_ID=<uuid>        # local display only; the API trusts the key, not this
# export BATCH_SECONDS=5
```

## 6. Run the bridge

```bash
python3 bridge.py
```

The bridge preserves every individual pulse timestamp but batches the network
traffic (default ~5s) — it never sends one HTTP request per pulse. Failed
uploads keep their buffer and retry. If the Uno reboots (seq or uptime resets)
the bridge rotates to a fresh `bootId` so restarted seq numbers can't collide
with previously stored rows.

### How it stays accurate and reliable

**Serial and HTTP run on separate threads.** A dedicated reader thread owns the
serial port and does nothing but parse pulses into an in-memory buffer; a
separate uploader batches and POSTs. So a slow upload, retry, DNS failure or
request timeout can **never stall serial acquisition** — pulses keep being
collected the whole time the network is down, and the backlog uploads on
reconnect. Acknowledged batches are removed from the buffer exactly once;
pulses that arrive during an in-flight upload are never dropped by it.

**The Arduino's uptime is the timing authority.** Each pulse carries the
Arduino's monotonic `uptime_ms`, which fixes the _relative_ spacing between
pulses. The Mac only supplies the _absolute_ UTC anchor: for each boot session
the bridge estimates `boot_epoch = min(host_receive_time − uptime)` and
reconstructs `timestamp = boot_epoch + uptime`. Using the minimum means
serial/OS queue delay (which can only make a pulse arrive _later_) never pushes
the anchor forward. The upshot: if several pulses are drained from the serial
buffer in a burst after a block, their reconstructed wall-clock times **still
preserve the spacing the Arduino measured** — they do not all collapse onto the
same instant (the bug this replaced). A reboot starts a fresh anchor for the
new `bootId`.

> ⚠️ **Prototype limitation:** the buffer is **RAM-only**. Pulses already
> collected but not yet uploaded live only in the bridge process's memory, so a
> full bridge-process crash, power loss, or `kill -9` can still lose unsent
> pulses. There is **no** crash-safe on-disk persistence yet. Ctrl+C attempts a
> final flush of whatever is queued, but a hard crash does not.

## 7. Verify pulses arrive

- The bridge prints `uploaded N pulse(s) … accepted=… duplicates=…` each cycle.
- In Supabase, `select count(*) from meter_pulses where device_id = '<uuid>'`
  grows as the LED flashes, and `meter_devices.last_seen_at` updates.
- Retried/duplicate batches raise `duplicates`, not `accepted` — the
  `(device_id, boot_id, seq)` unique constraint makes ingestion idempotent.

---

## Endpoint contract

`POST /api/live/pulses` — device authenticated.

```
Authorization: Bearer <DEVICE_KEY>
Content-Type: application/json

{
  "bootId": "UUID",                 // one boot/session of the measuring hardware
  "pulses": [                       // 1–100 per request
    {
      "seq": 148,                   // monotonic within a boot, >= 0
      "timestampMs": 1786127342184, // Unix epoch ms (assigned by the bridge on arrival)
      "uptimeMs": 97142,            // device elapsed ms, >= 0
      "deltaMs": 1803               // ms since previous pulse; null/omitted for the first
    }
  ]
}
```

Response: `{ "accepted": <n>, "duplicates": <n> }`. Identity (device +
connection) is derived entirely from the key — any `deviceId`/`connectionId` in
the body is ignored.

## Bridge logic tests

Pure parsing / reboot-detection logic is unit tested without serial or network:

```bash
cd hardware/prototype/bridge
python3 -m unittest discover
```
