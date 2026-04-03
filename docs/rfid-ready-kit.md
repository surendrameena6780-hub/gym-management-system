# RFID Ready Kit

This project is now prebuilt for later RFID gate integration even if the physical machine details are not known yet.

## What is already built

- Reader registry in the attendance page
- Reader shared-secret rotation
- Member card pairing and unpairing
- Recent RFID event log
- Backend reader event endpoint for gate scans
- Local bridge simulator script for dry runs

## What you need later from the machine vendor

- Brand and model number
- How to read the raw card UID
- Whether the machine exposes HTTP, SDK, TCP, serial, RS485, or Wiegand
- How the gate opens after approval
- Whether the screen can show allow and deny text

## Current backend endpoints

- `GET /api/attendance/rfid/devices`
- `POST /api/attendance/rfid/devices`
- `PUT /api/attendance/rfid/devices/:id`
- `POST /api/attendance/rfid/devices/:id/rotate-secret`
- `GET /api/attendance/rfid/events?limit=12`
- `POST /api/attendance/rfid/pair-member`
- `POST /api/attendance/rfid/unpair-member`
- `POST /api/attendance/rfid/event`

## Dry-run bridge usage

Register a reader in the Attendance page first. Save the generated `reader_serial` and `shared_secret`.

Run one simulated tap:

```bash
npm run rfid:simulate -- --api http://localhost:5000 --serial GATE-01 --key your_shared_key --tag 123456789
```

Run in interactive mode:

```bash
npm run rfid:simulate -- --api http://localhost:5000 --serial GATE-01 --key your_shared_key
```

Then enter tag IDs one by one in the terminal.

## Hardware hookup pattern later

1. Machine or controller reads card UID.
2. Local gateway sends UID to `POST /api/attendance/rfid/event`.
3. Backend returns allow or deny.
4. Local gateway opens the relay only when the response is successful.
5. Staff renew membership in the app, and the same card becomes valid again automatically.

## Recommended future bridge behavior

- Keep the gateway on the same LAN as the gate.
- Cache active tags locally for brief internet outages.
- Queue failed events for later sync.
- Rotate reader keys if a gateway is replaced.
- Keep `allow_expired_checkin` off for production gates unless there is a strict override workflow.