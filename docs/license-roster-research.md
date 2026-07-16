# SD food-license roster research (2026-07)

Can we get a roster of *licensed* food establishments to cross-check the
inspection data? Short answer: **South Dakota publishes no downloadable
roster** — not on doh.sd.gov, not on any state open-data portal, not via the
Department of Revenue. The inspection portal we already sync is the only
public window into the licensed universe. Findings below, all URLs verified
live.

## Key facts learned

- **The DOH portal only posts the last 2 years of scores; each new score
  replaces the oldest.** Our pipeline's retain-forever store is therefore the
  durable record — data we've captured is not recoverable from the source
  later. (Reinforces: never let the store regress.)
- The portal is the AFDO "USA Food Safety" platform (shared with Iowa,
  Illinois DPH, Washington Ag). No public API; classic WebForms postbacks;
  500-result cap per search. An export button (`lbExport`) exists on result
  pages — errored under scripted replay, worth one manual browser test.
- No other SD city runs its own inspection program — Rapid City, Aberdeen,
  Brookings, Watertown, Pierre all defer to SD DOH. Sioux Falls (SWEEPS) is
  the only independent program. We are not missing a second SWEEPS.

## Recommended actions

1. **Records request to SD DOH** (the real roster path): SDCL 1-27 request
   for the current licensed food-service establishment extract as CSV —
   name, address, license number/type/status. First hour of staff time is
   free, so this is likely $0. Contact: the DOH public records office
   (https://doh.sd.gov/contacts/records-request/). Would catch newly
   licensed establishments before their first posted inspection.
2. **Sioux Falls alcohol/VLT licensing layer** (trivial ingest, optional
   enrichment): ~1,045 geocoded records, CC-BY-4.0. Fields: BusinessName,
   OwnerName, BusinessAddress, LicenseType, on/off-sale, VLT count, Status.
   REST: https://gis.siouxfalls.gov/arcgis/rest/services/Data/Community/MapServer/20
   (request `outSR=4326`).
3. Rapid City license-holder PDFs (on/off-sale liquor, malt beverage):
   https://www.rcgov.org/departments/finance/license-holders-262.html —
   WAF blocks automated fetches; manual download only.

## Dead ends (checked, do not re-research)

- open.sd.gov = finance transparency only; opendata.sd.gov / data.sd.gov
  don't exist; SD GIS Open Data Hub has zero health/licensing datasets.
- SD DOR publishes no alcohol-licensee lists (issued via county auditors —
  fragmented locally); sales-tax license verification is phone-only.
- SD Secretary of State bulk business DB costs $1,500 setup + $750/mo —
  corporate filings, not food licenses; poor value.
- Tribal/IHS: inspections live in IHS WebEHRS (internal, not public, not in
  the eFOIA reading room). Only route is a FOIA to IHS
  (https://www.ihs.gov/foia/) for Great Plains Area food-service surveys.
  Documented as a coverage gap in data-coverage.md.
