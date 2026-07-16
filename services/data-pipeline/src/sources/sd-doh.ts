import puppeteer, { Browser, Page } from 'puppeteer';
import { store, type Severity, type GeoPrecision } from '../lib/store.js';
import { parseInspectionPDF } from './pdf-parser.js';
import { geocodeValidated } from '../processors/geocoder.js';
import { normalizeStreet } from '../lib/address.js';
import { standardizeAddress } from '../lib/usps.js';

interface SourceConfig {
  mode: 'full' | 'incremental' | 'backfill-scores';
  /** backfill-scores mode: external_id -> inspection dates (YYYY-MM-DD) lacking scores */
  backfillTargets?: Map<string, Set<string>>;
  dateRange?: { start: Date; end: Date };
  counties?: string[];
}

interface EstablishmentResult {
  name: string;
  address: string;
  city: string;
  phone: string | null;
  inspectionDate: string;
  inspectionType: string;
  score: number | null;
  violationCount: number;
  reportButtonId: string | null;
  violationsLinkId: string | null;
  pastInspectionsLinkId: string | null;
}

// Selectors matching the current SafeFoodInspection.com ASP.NET WebForms layout
const SELECTORS = {
  countyDropdown: '#MainContent_wucStateCountiesFS_ddlCounty',
  classificationDropdown: '#MainContent_ddlClassification',
  startDateInput: '#MainContent_dteInspectionBeginDate_txtDate',
  endDateInput: '#MainContent_dteInspectionEndDate_txtDate',
  searchButton: '#MainContent_btnSearch',
  resultsTable: '#MainContent_gvInspections',
  resultsPanel: '#MainContent_pnlResults',
};

// South Dakota counties
const SD_COUNTIES = [
  'Aurora', 'Beadle', 'Bennett', 'Bon Homme', 'Brookings', 'Brown', 'Brule',
  'Buffalo', 'Butte', 'Campbell', 'Charles Mix', 'Clark', 'Clay', 'Codington',
  'Corson', 'Custer', 'Davison', 'Day', 'Deuel', 'Dewey', 'Douglas', 'Edmunds',
  'Fall River', 'Faulk', 'Grant', 'Gregory', 'Haakon', 'Hamlin', 'Hand',
  'Hanson', 'Harding', 'Hughes', 'Hutchinson', 'Hyde', 'Jackson', 'Jerauld',
  'Jones', 'Kingsbury', 'Lake', 'Lawrence', 'Lincoln', 'Lyman', 'Marshall',
  'McCook', 'McPherson', 'Meade', 'Mellette', 'Miner', 'Minnehaha', 'Moody',
  'Oglala Lakota', 'Pennington', 'Perkins', 'Potter', 'Roberts', 'Sanborn',
  'Spink', 'Stanley', 'Sully', 'Todd', 'Tripp', 'Turner', 'Union', 'Walworth',
  'Yankton', 'Ziebach'
];

// Throttle settings to avoid IP bans — conservative to stay under the radar
const THROTTLE = {
  betweenCounties: { min: 20_000, max: 45_000 },     // 20-45s between county searches
  betweenEstablishments: { min: 3_000, max: 8_000 },  // 3-8s between establishments
  betweenPages: { min: 10_000, max: 20_000 },         // 10-20s between result pages
  afterViolationModal: { min: 2_000, max: 5_000 },    // 2-5s after closing violation modal
};

function randomDelay(range: { min: number; max: number }): Promise<void> {
  const ms = range.min + Math.random() * (range.max - range.min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SDDOHSource {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: SourceConfig;
  private stats = { restaurants: 0, inspections: 0, violations: 0 };

  constructor(config: SourceConfig) {
    this.config = config;
  }

  getStats(): { restaurants: number; inspections: number; violations: number } {
    return { ...this.stats };
  }

  async initialize(): Promise<void> {
    console.log('Initializing browser...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(60000);

    // Look like a normal browser to avoid WAF/rate-limit blocks
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await this.page.setViewport({ width: 1280, height: 900 });

    await this.page.goto(
      'https://sddoh.safefoodinspection.com/Inspection/publicinspectionsearch.aspx',
      { waitUntil: 'networkidle0' }
    );
    console.log('Browser initialized and page loaded');
  }

  async syncAll(): Promise<void> {
    const counties = this.config.counties ?? SD_COUNTIES;
    const failedCounties: string[] = [];
    let consecutiveTimeouts = 0;

    for (let i = 0; i < counties.length; i++) {
      const county = counties[i];
      let attempts = 0;
      let ok = false;
      while (!ok && attempts < 2) {
        attempts++;
        try {
          console.log(`\n[${i + 1}/${counties.length}] Syncing county: ${county}${attempts > 1 ? ' (retry)' : ''}`);
          await this.syncByCounty(county);
          ok = true;
          consecutiveTimeouts = 0;
        } catch (error) {
          const msg = String(error);
          console.error(`Error syncing county ${county}:`, msg);

          // Recover from detached frame by opening a fresh page
          if (msg.includes('detached') || msg.includes('Detached') || msg.includes('Target closed')) {
            console.log('  Recovering: opening fresh page...');
            await this.recoverPage();
          }

          // Connection timeouts mean the portal is blocking/down — a previous
          // run burned through 40 counties this way. Cool down before retrying
          // once; escalate the pause when timeouts persist across counties.
          if (/TIMED_OUT|ECONN|net::ERR/.test(msg)) {
            consecutiveTimeouts++;
            const pauseMin = Math.min(5 * consecutiveTimeouts, 20);
            console.log(`  Portal unresponsive (${consecutiveTimeouts} in a row) — cooling down ${pauseMin} min...`);
            await new Promise((r) => setTimeout(r, pauseMin * 60_000));
          }
        }
      }
      if (!ok) failedCounties.push(county);

      // Persist after every county so a timeout/crash mid-run keeps all
      // completed counties (a full statewide pass runs for hours).
      const { restaurantsWritten } = store.save();
      console.log(`  Saved ${restaurantsWritten} restaurant files through ${county}`);

      // Throttle between counties
      if (i < counties.length - 1) {
        await randomDelay(THROTTLE.betweenCounties);
      }
    }

    if (failedCounties.length) {
      console.error(`\nCOUNTIES FAILED AFTER RETRY (${failedCounties.length}): ${failedCounties.join(' ')}`);
      console.error('Re-run with: npm run sync:counties -- ' + failedCounties.map((c) => `"${c}"`).join(' '));
    }

    console.log('\n=== SYNC SUMMARY ===');
    console.log(`Restaurants: ${this.stats.restaurants}`);
    console.log(`Inspections: ${this.stats.inspections}`);
    console.log(`Violations: ${this.stats.violations}`);
  }

  async syncByCounty(county: string): Promise<void> {
    if (!this.page) throw new Error('Source not initialized');

    // Always navigate fresh — ASP.NET postbacks can detach the frame
    await this.page.goto(
      'https://sddoh.safefoodinspection.com/Inspection/publicinspectionsearch.aspx',
      { waitUntil: 'networkidle0' }
    );

    // The county dropdown uses numeric values; select by matching visible text
    const countyValue = await this.page.evaluate((selector: string, countyName: string) => {
      const sel = document.querySelector(selector) as HTMLSelectElement;
      if (!sel) return null;
      for (const opt of Array.from(sel.options)) {
        if (opt.text.trim() === countyName) return opt.value;
      }
      return null;
    }, SELECTORS.countyDropdown, county);

    if (!countyValue) {
      console.warn(`County "${county}" not found in dropdown, skipping`);
      return;
    }

    await this.page.select(SELECTORS.countyDropdown, countyValue);

    // Select classification "Food"
    await this.page.select(SELECTORS.classificationDropdown, 'Food');

    // Set date range for incremental syncs
    if (this.config.mode === 'incremental' && this.config.dateRange) {
      // Clear existing values first
      await this.page.evaluate((startSel: string, endSel: string) => {
        const startEl = document.querySelector(startSel) as HTMLInputElement;
        const endEl = document.querySelector(endSel) as HTMLInputElement;
        if (startEl) startEl.value = '';
        if (endEl) endEl.value = '';
      }, SELECTORS.startDateInput, SELECTORS.endDateInput);
      await this.page.type(SELECTORS.startDateInput, this.formatDate(this.config.dateRange.start));
      await this.page.type(SELECTORS.endDateInput, this.formatDate(this.config.dateRange.end));
    }

    // Submit search — handle both full navigation and AJAX UpdatePanel postback.
    // Race: click may trigger navigation (some counties) or just an AJAX update.
    const navigationPromise = this.page.waitForNavigation({
      waitUntil: 'networkidle0',
      timeout: 120000,
    }).catch(() => null);

    await this.page.click(SELECTORS.searchButton);

    // Wait for either navigation to complete or results to appear via AJAX
    await Promise.race([
      navigationPromise,
      this.page.waitForFunction(
        (tableSel: string, panelSel: string) => {
          const table = document.querySelector(tableSel);
          const panel = document.querySelector(panelSel);
          // Check for data rows (more than just the header)
          if (table) {
            const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
            const dataRows = Array.from(rows).filter(r => r.querySelectorAll('td').length >= 4);
            if (dataRows.length > 0) return true;
          }
          if (panel) {
            const text = panel.textContent || '';
            if (text.includes('No records') || text.includes('0 record')) return true;
          }
          return false;
        },
        { timeout: 120000 },
        SELECTORS.resultsTable,
        SELECTORS.resultsPanel
      ),
    ]);

    // Check for results table
    const hasResults = await this.page.$(SELECTORS.resultsTable);
    if (!hasResults) {
      console.log(`No results for county: ${county}`);
      return;
    }

    // Check if "No records found" text is present
    const noRecords = await this.page.evaluate((panelSel: string) => {
      const panel = document.querySelector(panelSel);
      if (!panel) return true;
      const text = panel.textContent || '';
      // Use word boundary check — "0 record" could match "80 record(s)"
      return text.includes('No records') || /\b0 record/i.test(text);
    }, SELECTORS.resultsPanel);

    if (noRecords) {
      console.log(`No results for county: ${county}`);
      return;
    }

    // Process all pages of results
    let pageNum = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`  Processing page ${pageNum}...`);
      const establishments = await this.extractEstablishments();
      console.log(`  Found ${establishments.length} establishments on page ${pageNum}`);

      for (let j = 0; j < establishments.length; j++) {
        try {
          if (this.config.mode === 'backfill-scores') {
            const did = await this.backfillEstablishmentScores(establishments[j]);
            if (!did) continue; // skip throttle for non-targets
          } else {
            await this.processEstablishment(establishments[j], county);
          }
        } catch (error) {
          console.error(`  Error processing ${establishments[j].name}:`, error);
        }

        // Throttle between establishments
        if (j < establishments.length - 1) {
          await randomDelay(THROTTLE.betweenEstablishments);
        }
      }

      // Throttle before loading next page
      await randomDelay(THROTTLE.betweenPages);

      // Check for next page link in pagination
      hasNextPage = await this.goToNextPage(pageNum);
      pageNum++;
    }
  }

  private async goToNextPage(currentPage: number): Promise<boolean> {
    if (!this.page) return false;

    const nextPageNum = currentPage + 1;

    // ASP.NET GridView pagination shows numbered links plus "..." ellipsis links.
    // Visible pages might be: "1 2 3 4 5 6 7 8 9 10 ..."
    // After clicking "...", it shows: "... 11 12 13 14 15 16 17 18 19 20 ..."
    //
    // Strategy: first try to find the exact next page number link.
    // If not found, look for a "..." (ellipsis) link that leads forward.
    const postbackArg = await this.page.evaluate((tableSel: string, nextPage: number, curPage: number) => {
      const table = document.querySelector(tableSel);
      if (!table) return null;

      // The pagination row is the last row in the table
      const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
      const lastRow = rows[rows.length - 1];
      if (!lastRow) return null;

      const links = Array.from(lastRow.querySelectorAll('a'));

      // First: try exact page number match
      for (const link of links) {
        if (link.textContent?.trim() === String(nextPage)) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/__doPostBack\('([^']+)','([^']+)'\)/);
          if (match) {
            return { target: match[1], argument: match[2] };
          }
        }
      }

      // Second: look for "..." ellipsis link that navigates forward
      // There can be two "..." links — one going backward, one forward.
      // We identify "forward" by checking if its Page$N argument has N > currentPage.
      let forwardEllipsis: { target: string; argument: string } | null = null;
      for (const link of links) {
        const text = link.textContent?.trim();
        if (text === '...' || text === '…') {
          const href = link.getAttribute('href') || '';
          const match = href.match(/__doPostBack\('([^']+)','([^']+)'\)/);
          if (match) {
            const pageMatch = match[2].match(/Page\$(\d+)/);
            const targetPage = pageMatch ? parseInt(pageMatch[1], 10) : 0;
            if (targetPage > curPage) {
              forwardEllipsis = { target: match[1], argument: match[2] };
            }
          }
        }
      }

      return forwardEllipsis;
    }, SELECTORS.resultsTable, nextPageNum, currentPage);

    if (!postbackArg) return false;

    try {
      // Capture the first data cell text so we can detect when the grid refreshes
      const firstCellText = await this.page.evaluate((tableSel: string) => {
        const table = document.querySelector(tableSel);
        if (!table) return '';
        const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
        // Row 0 is header, row 1 is first data row
        if (rows.length < 2) return '';
        const cells = rows[1]?.querySelectorAll(':scope > td');
        return cells?.[0]?.textContent?.trim().substring(0, 50) || '';
      }, SELECTORS.resultsTable);

      // Execute the __doPostBack (triggers async UpdatePanel refresh, not full navigation)
      await this.page.evaluate((target: string, arg: string) => {
        // @ts-ignore - __doPostBack is defined by ASP.NET
        __doPostBack(target, arg);
      }, postbackArg.target, postbackArg.argument);

      // Wait for the grid content to change (the first cell text should differ on a new page)
      await this.page.waitForFunction(
        (tableSel: string, oldText: string) => {
          const table = document.querySelector(tableSel);
          if (!table) return false;
          const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
          if (rows.length < 2) return false;
          const cells = rows[1]?.querySelectorAll(':scope > td');
          const newText = cells?.[0]?.textContent?.trim().substring(0, 50) || '';
          return newText !== oldText && newText !== '';
        },
        { timeout: 60000 },
        SELECTORS.resultsTable,
        firstCellText
      );

      // Brief additional wait for any animations/blocking overlays to clear
      await new Promise(resolve => setTimeout(resolve, 500));

      return true;
    } catch {
      return false;
    }
  }

  private async extractEstablishments(): Promise<EstablishmentResult[]> {
    if (!this.page) return [];

    return await this.page.evaluate((tableSel: string) => {
      const table = document.querySelector(tableSel);
      if (!table) return [];

      const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
      const results: EstablishmentResult[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll(':scope > td');

        // Skip header row, pagination row, and sub-table rows (past inspections)
        if (cells.length < 4) continue;

        // The main inspection rows have: Name/Address | Date | Type | Score | Attribution | Violations | Report | PastInspections
        const nameAddressCell = cells[0];
        const dateCell = cells[1];
        const typeCell = cells[2];
        const scoreCell = cells[3];

        // Cell structure: "NAME<br><div>ADDRESS  City, SD ZIP</div><div>PHONE</div>"
        // Extract name from text node before the <br>
        const cellHTML = nameAddressCell?.innerHTML || '';
        if (!cellHTML || cellHTML.includes('Name / Address')) continue; // header row

        // Name is the first text node in the cell (before the <br> tag)
        // We get it from the cell's childNodes to avoid HTML entity issues
        let name = '';
        for (const node of Array.from(nameAddressCell?.childNodes || [])) {
          if (node.nodeType === Node.TEXT_NODE) {
            const txt = node.textContent?.trim();
            if (txt) { name = txt; break; }
          }
        }
        if (!name) continue;

        // Skip rows where "name" is actually a date (sub-table past inspection rows)
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(name)) continue;

        // Address is in the first <div>
        const divs = nameAddressCell?.querySelectorAll('div') || [];
        const addressDiv = divs[0]?.textContent?.trim() || '';
        // Second div carries the phone number when the source has one
        const phoneText = divs[1]?.textContent?.trim() || '';
        const phone = phoneText.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/)?.[0] ?? null;

        // Parse address: "501 N  SPLIT ROCK  BLVD  Brandon, SD 57005"
        // Strategy: match known multi-word city names first, then fall back
        // to double-space heuristic.
        let address = addressDiv;
        let city = '';
        const sdMatch = addressDiv.match(/^(.+?),\s*SD\s*\d*/);
        if (sdMatch) {
          const beforeSD = sdMatch[1].trim();

          // Known multi-word SD cities — match these first (case-insensitive)
          const multiWordCities = [
            'Rapid City', 'Sioux Falls', 'North Sioux City', 'Box Elder',
            'Belle Fourche', 'Hot Springs', 'Fort Pierre', 'Dell Rapids',
            'Black Hawk', 'Hill City', 'Lead Deadwood', 'Pine Ridge',
            'Eagle Butte', 'Elk Point', 'Tea Area', 'Dakota Dunes',
            'Whitewood', 'Summerset', 'Colonial Pine Hills',
          ];
          let matched = false;
          for (const mc of multiWordCities) {
            const idx = beforeSD.toLowerCase().lastIndexOf(mc.toLowerCase());
            if (idx > 0) {
              address = beforeSD.substring(0, idx).trim().replace(/\s{2,}/g, ' ');
              city = beforeSD.substring(idx).trim();
              matched = true;
              break;
            }
          }

          if (!matched) {
            // Fall back to double-space heuristic, but grab ALL words after
            // the last double-space (handles "Rapid City" if not in list)
            const lastDoubleSpace = beforeSD.lastIndexOf('  ');
            if (lastDoubleSpace > 0) {
              address = beforeSD.substring(0, lastDoubleSpace).trim().replace(/\s{2,}/g, ' ');
              city = beforeSD.substring(lastDoubleSpace).trim();
            } else {
              const lastSpace = beforeSD.lastIndexOf(' ');
              if (lastSpace > 0) {
                address = beforeSD.substring(0, lastSpace).trim();
                city = beforeSD.substring(lastSpace).trim();
              } else {
                address = beforeSD;
              }
            }
          }
        }

        const inspectionDate = dateCell?.textContent?.trim() || '';
        const inspectionType = typeCell?.textContent?.trim() || '';
        const scoreText = scoreCell?.textContent?.trim() || '';
        const score = scoreText ? parseInt(scoreText, 10) : null;

        // Count violations from the violations link text (e.g., "Violation(s) 5")
        const violationsLink = row.querySelector('a[id*="lnkViolations"]');
        const violationsText = violationsLink?.textContent?.trim() || '';
        const violationMatch = violationsText.match(/(\d+)/);
        const violationCount = violationMatch ? parseInt(violationMatch[1], 10) : 0;

        // Get IDs for report button and links
        const reportButton = row.querySelector('input[id*="btnInspectionReport"]');
        const pastInspLink = row.querySelector('a[id*="lnkPastInspections"]');

        results.push({
          name,
          address,
          city,
          phone,
          inspectionDate,
          inspectionType,
          score: isNaN(score as number) ? null : score,
          violationCount,
          reportButtonId: reportButton?.id || null,
          violationsLinkId: violationsLink?.id || null,
          pastInspectionsLinkId: pastInspLink?.id || null,
        });
      }

      return results;
    }, SELECTORS.resultsTable);
  }

  private async processEstablishment(
    establishment: EstablishmentResult,
    county: string
  ): Promise<void> {
    console.log(`  Processing: ${establishment.name} (${establishment.inspectionDate}, score: ${establishment.score})`);

    // Generate external ID for deduplication
    const externalId = this.generateExternalId(establishment);

    // Locate the restaurant via the USPS-validated pipeline. Never downgrade:
    // an existing rooftop/address-precision coordinate for the same source
    // address is kept without re-geocoding.
    const rawAddress = `${establishment.address}, ${establishment.city}`;
    const existing = store.getRestaurant(externalId);
    let coordinates: { lat: number; lng: number };
    let precision: GeoPrecision | null = existing?.geo_precision ?? null;
    let displayStreet = establishment.address;
    let displayCity = establishment.city;
    let zip: string | null = existing?.zip_code ?? null;

    const keepExisting =
      existing &&
      existing.source_address === rawAddress &&
      (existing.geo_precision === 'rooftop' || existing.geo_precision === 'address');

    if (keepExisting) {
      coordinates = { lat: existing.latitude, lng: existing.longitude };
      displayStreet = existing.address;
      displayCity = existing.city;
    } else {
      const norm = normalizeStreet(establishment.address);
      let geoStreet = norm.street;
      let geoCity = establishment.city;
      try {
        const usps = await standardizeAddress(norm.street, establishment.city, zip);
        if (usps) {
          geoStreet = usps.street;
          geoCity = usps.city.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
          zip = usps.zip5;
        }
      } catch (error) {
        console.warn(`  USPS unavailable for ${rawAddress}:`, String(error).slice(0, 100));
      }
      displayStreet = norm.unit ? `${geoStreet} ${norm.unit}` : geoStreet;
      displayCity = geoCity;

      const geo = await geocodeValidated(geoStreet, geoCity, zip);
      if (geo) {
        coordinates = { lat: geo.lat, lng: geo.lng };
        precision = geo.precision;
      } else if (existing) {
        // Unresolvable now — keep whatever we had rather than move it
        coordinates = { lat: existing.latitude, lng: existing.longitude };
      } else {
        coordinates = this.getCountyCenter(county);
        precision = 'city';
      }
    }

    // Upsert restaurant
    const restaurantId = store.upsertRestaurant({
      external_id: externalId,
      name: establishment.name,
      address: displayStreet,
      city: displayCity,
      state: 'SD',
      zip_code: zip,
      phone: establishment.phone ?? existing?.phone ?? null,
      latitude: coordinates.lat,
      longitude: coordinates.lng,
      source: 'sd_doh',
      geo_precision: precision,
      source_address: rawAddress,
    });

    this.stats.restaurants++;

    // Insert inspection record from the grid data
    if (establishment.inspectionDate) {
      const parsedDate = this.parseDate(establishment.inspectionDate);
      if (parsedDate) {
        const inspection = store.upsertInspection(restaurantId, {
          date: parsedDate,
          score: establishment.score,
          grade: this.calculateGrade(establishment.score),
          inspection_type: establishment.inspectionType,
          comments: '',
          violationCount: establishment.violationCount,
        });
        this.stats.inspections++;

        // If there are violations, try to extract them by clicking the violations link
        if (establishment.violationCount > 0 && establishment.violationsLinkId) {
          try {
            const violations = await this.extractViolations(establishment.violationsLinkId);
            for (const v of violations) {
              store.upsertViolation(inspection, {
                code: v.code,
                description: v.description,
                severity: v.severity as Severity,
                corrected: v.corrected,
              });
            }
            this.stats.violations += violations.length;
          } catch (error) {
            console.warn(`  Failed to extract violations:`, error);
          }
        }
      }
    }

    // Capture historical inspections (date, type, violation count) from the
    // "Past Inspections" expander. It carries counts, not scores or details.
    if (establishment.pastInspectionsLinkId) {
      try {
        const past = await this.extractPastInspections(establishment.pastInspectionsLinkId);
        for (const pi of past) {
          const pd = this.parseDate(pi.date);
          if (!pd) continue;
          store.upsertInspection(restaurantId, {
            date: pd,
            score: null,
            inspection_type: pi.type,
            violationCount: pi.violationCount,
          });
          this.stats.inspections++;
        }
      } catch (error) {
        console.warn(`  Failed to extract past inspections:`, error);
      }
    }
  }

  /**
   * Click an establishment's "Past Inspections" link and parse the injected
   * nested table: each row is a prior inspection with a date, type, and
   * violation count (no score — that lives only in the PDF report).
   */
  private async extractPastInspections(
    linkId: string
  ): Promise<Array<{ date: string; type: string; violationCount: number; reportButtonId: string | null }>> {
    if (!this.page) return [];
    const idx = linkId.match(/_(\d+)$/)?.[1];
    if (!idx) return [];
    const tableId = `MainContent_gvInspections_gvPastInspections_${idx}`;
    try {
      await this.page.evaluate((id: string) => {
        const el = document.getElementById(id);
        if (el) (el as HTMLElement).click();
      }, linkId);
      await this.page.waitForSelector(`#${tableId}`, { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = await this.page.evaluate((tid: string) => {
        const tbl = document.getElementById(tid);
        if (!tbl) return [];
        const out: Array<{ date: string; type: string; violationCount: number; reportButtonId: string | null }> = [];
        for (const r of Array.from(tbl.querySelectorAll('tr.GridItem, tr.GridAltItem'))) {
          const tds = r.querySelectorAll(':scope > td');
          if (tds.length < 3) continue;
          const date = tds[0].textContent?.trim() || '';
          const type = tds[1].textContent?.trim() || '';
          const vtext = tds[2].textContent?.trim() || '';
          const m = vtext.match(/(\d+)/);
          const btn = r.querySelector('input[id*="btnInspectionReport"]');
          if (date) out.push({ date, type, violationCount: m ? parseInt(m[1], 10) : 0, reportButtonId: btn?.id || null });
        }
        return out;
      }, tableId);
      return rows;
    } catch (error) {
      console.warn(`  Failed to extract past inspections from ${linkId}:`, error);
      return [];
    }
  }

  private async extractViolations(violationsLinkId: string): Promise<
    Array<{ code: string; description: string; severity: string; corrected: boolean }>
  > {
    if (!this.page) return [];

    // Clicking the violations link opens a jQuery colorbox modal via AJAX.
    // The modal contains an ASP.NET repeater (rptViolations) with:
    //   - span[id*="lblRegulatorCodeType_N"]  → violation code (e.g. "44:02:07:55")
    //   - div[id*="pnlCodeExplanation_N"]     → hidden panel with code explanation
    //   - div[id*="pnlComments_N"]            → inspector comments
    try {
      await this.page.click(`#${violationsLinkId}`);

      // Wait for the colorbox modal to become visible with content
      await this.page.waitForSelector('#cboxLoadedContent span[id*="lblRegulatorCodeType"]', {
        timeout: 10000,
      });
      // Brief extra wait for content to finish rendering
      await new Promise(resolve => setTimeout(resolve, 500));

      // Extract violation data from the colorbox modal
      const violations = await this.page.evaluate(() => {
        const cbox = document.querySelector('#cboxLoadedContent');
        if (!cbox) return [];

        const results: Array<{ code: string; description: string; severity: string; corrected: boolean }> = [];

        // Find all violation code spans in the repeater
        const codeSpans = Array.from(cbox.querySelectorAll('span[id*="lblRegulatorCodeType"]'));
        for (const span of codeSpans) {
          const code = span.textContent?.trim() || '';
          if (!code) continue;

          // Extract the repeater index from the span ID (e.g. "..._lblRegulatorCodeType_3")
          const idxMatch = span.id.match(/_(\d+)$/);
          const idx = idxMatch ? idxMatch[1] : '';

          // Get the code explanation from the hidden panel
          // Structure: div#pnlCodeExplanation > div > span "Code Explanation" + div(actual text)
          const explanationPanel = idx
            ? cbox.querySelector(`[id*="pnlCodeExplanation_${idx}"]`)
            : null;
          let explanation = '';
          if (explanationPanel) {
            // Structure: div#pnl > div(padding:20px) > span("Code Explanation") + div(padding:10px)(text)
            // Target the innermost div (depth 2) which contains only the explanation text
            const innerDiv = explanationPanel.querySelector('div > div');
            if (innerDiv && !innerDiv.querySelector('span')) {
              // This is the leaf div with just text
              explanation = innerDiv.textContent?.trim() || '';
            }
            if (!explanation) {
              // Fallback: strip label from full text and collapse whitespace
              explanation = (explanationPanel.textContent || '')
                .replace(/Code\s*Explanation/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            }
          }

          // Get inspector comments
          // Structure: div#pnlComments > span "Inspector Comments" + <br> + text
          const commentsPanel = idx
            ? cbox.querySelector(`[id*="pnlComments_${idx}"]`)
            : null;
          let comments = '';
          if (commentsPanel) {
            // Get text content, strip the "Inspector Comments" label, and clean whitespace
            comments = (commentsPanel.textContent || '')
              .replace(/Inspector\s*Comments/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          }

          // Build description: explanation + comments
          const description = [explanation, comments].filter(Boolean).join(' — ');

          // Check for "Corrected Onsite" / "COS" in the comments text
          const corrected = /corrected\s*on\s*site|corrected\s*onsite|\bCOS\b/i.test(comments);

          results.push({ code, description, severity: '', corrected });
        }

        return results;
      });

      // Close the colorbox modal
      await this.page.evaluate(() => {
        const closeBtn = document.querySelector('#cboxClose') as HTMLElement;
        if (closeBtn) closeBtn.click();
      });
      // Wait for colorbox to close
      await this.page.waitForFunction(
        () => {
          const cb = document.querySelector('#colorbox') as HTMLElement;
          return !cb || cb.style.display === 'none' || cb.offsetParent === null;
        },
        { timeout: 5000 }
      ).catch(() => {}); // non-critical if it times out

      // Throttle after closing the modal
      await randomDelay(THROTTLE.afterViolationModal);

      // Map severity based on SD administrative code sections
      return violations.map(v => ({
        ...v,
        severity: this.mapSDCodeToSeverity(v.code),
      }));
    } catch (error) {
      // Try to close colorbox in case it opened but parsing failed
      try {
        await this.page.evaluate(() => {
          const closeBtn = document.querySelector('#cboxClose') as HTMLElement;
          if (closeBtn) closeBtn.click();
        });
      } catch {}
      console.warn(`  Failed to extract violations from ${violationsLinkId}:`, error);
      return [];
    }
  }

  /**
   * Map SD DOH administrative code (e.g. "44:02:07:XX") to a severity level.
   *
   * SD uses ARSD Title 44, Chapter 02:07 (Food Service) codes. The public UI
   * does not expose a P/C/M severity field, so we classify based on the code
   * section number per food safety risk:
   *
   * Critical (foodborne illness risk):
   *   :09-:14  Temperature control, cooking, reheating, cooling
   *   :15-:21  Food source, condition, adulteration
   *   :22-:24  Cross-contamination, storage, separation
   *   :25-:31  Employee health, hygiene, handwashing
   *   :56-:60  Sanitizing, warewashing
   *
   * Major (indirect risk / facility):
   *   :32-:46  Toxic substances, labeling, allergens
   *   :47-:55  Equipment design, condition, cleaning
   *   :61-:65  Water, plumbing, sewage
   *
   * Minor (general maintenance):
   *   :66-:99  Physical facilities, floors, walls, lighting, ventilation, etc.
   *   :01-:08  Licensing, plan review, definitions (administrative)
   */
  private mapSDCodeToSeverity(code: string): string {
    // Extract the last section number from codes like "44:02:07:55"
    const parts = code.split(':');
    const sectionStr = parts[parts.length - 1];
    const section = parseInt(sectionStr, 10);

    if (isNaN(section)) return 'minor';

    // Critical: temperature, cooking, cross-contamination, hygiene, sanitizing
    if ((section >= 9 && section <= 31) || (section >= 56 && section <= 60)) {
      return 'critical';
    }

    // Major: toxic substances, equipment, water/plumbing
    if ((section >= 32 && section <= 55) || (section >= 61 && section <= 65)) {
      return 'major';
    }

    // Minor: physical facilities, administrative
    return 'minor';
  }

  // ---- PDF score backfill -------------------------------------------------

  /**
   * Fetch an inspection-report PDF by replaying the button's WebForms
   * postback as an in-page fetch. Image buttons submit only their name.x/.y
   * coordinates (no __EVENTTARGET). The server responds with the page HTML
   * containing a startup script that opens /Common/ExternalFileViewer.aspx
   * with a one-time ID+Key — fetching that URL returns the PDF. The grid
   * page itself is left untouched: no navigation, no popups, no downloads.
   */
  private async fetchPdfViaPostback(buttonId: string): Promise<Buffer | null> {
    if (!this.page) return null;
    const b64 = await this.page.evaluate(async (id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      const form = document.forms[0] as HTMLFormElement | undefined;
      if (!el || !form || !el.name) return null;
      const params = new URLSearchParams();
      for (const [k, v] of new FormData(form).entries()) params.set(k, String(v));
      params.set(el.name + '.x', '5');
      params.set(el.name + '.y', '5');
      const resp = await fetch(form.action || window.location.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        credentials: 'same-origin',
      });
      const html = await resp.text();
      const m = html.match(/['"]([^'"]*ExternalFileViewer\.aspx[^'"]*)['"]/i);
      if (!m) return null;
      const viewerUrl = new URL(m[1].replace(/&amp;/g, '&'), window.location.href).href;
      const pdfResp = await fetch(viewerUrl, { credentials: 'same-origin' });
      const ct = pdfResp.headers.get('content-type') ?? '';
      if (!/pdf|octet-stream/i.test(ct)) return null;
      const buf = new Uint8Array(await pdfResp.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 0x8000)));
      }
      return btoa(s);
    }, buttonId);
    return b64 ? Buffer.from(b64, 'base64') : null;
  }

  /**
   * backfill-scores mode: for a target establishment, download the PDF report
   * for each inspection date that lacks a score and upsert score+violations.
   * Returns false when the establishment isn't a target (caller skips throttle).
   */
  private async backfillEstablishmentScores(establishment: EstablishmentResult): Promise<boolean> {
    const externalId = this.generateExternalId(establishment);
    const needed = this.config.backfillTargets?.get(externalId);
    if (!needed || needed.size === 0) return false;
        console.log(`  Backfilling ${establishment.name}: ${needed.size} inspection(s) need scores`);

    const handlePdf = async (buttonId: string, date: string) => {
      const pdf = await this.fetchPdfViaPostback(buttonId);
      if (!pdf) {
        console.warn(`    no PDF for ${date}`);
        return;
      }
      try {
        const parsed = await parseInspectionPDF(pdf);
        if (parsed.score !== null) {
          const ref = store.upsertInspection(externalId, {
            date,
            score: parsed.score,
            grade: this.calculateGrade(parsed.score),
          });
          for (const v of parsed.violations ?? []) {
            store.upsertViolation(ref, {
              code: v.code,
              description: v.description,
              // PDF scoresheet items mark critical with "*" — the parser
              // already resolved severity from that, not the citation code
              severity: v.severity as Severity,
              corrected: v.corrected ?? false,
            });
          }
          this.stats.inspections++;
          console.log(`    ${date}: score ${parsed.score}, ${parsed.violations?.length ?? 0} violations`);
        } else {
          console.warn(`    ${date}: PDF parsed but no score found`);
        }
      } catch (e) {
        console.warn(`    ${date}: PDF parse failed`, String(e).slice(0, 100));
      }
      await randomDelay(THROTTLE.afterViolationModal);
    };

    // Latest inspection (main grid row)
    const latestDate = this.parseDate(establishment.inspectionDate);
    if (latestDate && needed.has(latestDate) && establishment.reportButtonId) {
      await handlePdf(establishment.reportButtonId, latestDate);
    }

    // Past inspections (expander rows carry their own report buttons)
    if (establishment.pastInspectionsLinkId) {
      const past = await this.extractPastInspections(establishment.pastInspectionsLinkId);
      for (const pi of past) {
        const d = this.parseDate(pi.date);
        if (d && needed.has(d) && pi.reportButtonId) {
          await handlePdf(pi.reportButtonId, d);
        }
      }
    }
    return true;
  }

  private generateExternalId(establishment: EstablishmentResult): string {
    const normalized = `${establishment.name}-${establishment.address}-${establishment.city}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');
    return `sd_doh_${normalized}`;
  }

  private formatDate(date: Date): string {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }

  private parseDate(dateStr: string): string | null {
    // Parse MM/DD/YYYY format to YYYY-MM-DD
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  private calculateGrade(score: number | null): string {
    if (score === null) return 'N/A';
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private getCountyCenter(county: string): { lat: number; lng: number } {
    // Approximate centers for major SD counties
    const centers: Record<string, { lat: number; lng: number }> = {
      'Minnehaha': { lat: 43.5461, lng: -96.7313 },
      'Pennington': { lat: 44.0806, lng: -103.2310 },
      'Lincoln': { lat: 43.2802, lng: -96.7219 },
      'Brown': { lat: 45.4606, lng: -98.4648 },
      'Brookings': { lat: 44.3114, lng: -96.7984 },
      'Codington': { lat: 44.9078, lng: -97.0892 },
      'Lawrence': { lat: 44.3900, lng: -103.8589 },
      'Meade': { lat: 44.5700, lng: -102.4900 },
      'Davison': { lat: 43.6735, lng: -98.0657 },
      'Yankton': { lat: 42.8839, lng: -97.3973 },
    };

    return centers[county] || { lat: 44.3668, lng: -100.3538 }; // SD center
  }

  /**
   * Recover from a detached frame by closing the old page and opening a fresh one.
   */
  private async recoverPage(): Promise<void> {
    if (!this.browser) throw new Error('Browser not available for recovery');

    try {
      if (this.page) await this.page.close().catch(() => {});
    } catch {}

    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(60000);
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await this.page.setViewport({ width: 1280, height: 900 });
    console.log('  Recovery complete — new page ready');
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      console.log('Browser closed');
    }
  }
}
