# fixtures

- `changes-2026-10-21.json`, `changes-2026-10-22.json`: the published change files of those days, byte for byte
  (`indicators/changes/<date>.json`, public): the NMS:PMNM first status of 10-21 and the one `new` row of 10-22 (mr_eez).
- `changes-2026-10-23.json`: synthetic rows at real places (a `new` OBIS row, a `period` row, a status word change), for
  the daily cap, the weekly cadence and the rules.
- `latest.json`: `indicators/changes/latest.json` as the build writes it, over those three files.
- `indicators.json`: four indicators of the manifest (id, series, lead, tags) and its one place set.

Addresses in tests are `example.org` / `example.com` only (RFC 2606).
