import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  applySchemeExpiryRules,
  getBundledSchemes,
  getTodayPakistanIsoDate,
  isOfficialPakistanPortalUrl,
  isValidIsoDateString,
  sortSchemesActiveFirst,
  type GovernmentSchemeItem,
} from '../lib/schemes';
import {
  isSchemesStateStale,
  SCHEMES_AUTO_REFRESH_TTL_MS,
  validateDiscoveredSchemeCandidate,
} from '../lib/server/schemes-store';
import { GET as schemesGet } from '../app/api/schemes/route';
import { GET as schemesRefreshGet } from '../app/api/schemes/refresh/route';

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function testCase(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  PASS: ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL: ${name}`);
      console.error(err);
    }
  }

  console.log('\n=== Schemes Zero-Admin Auto-Expiry & Auto-Update Suite ===');

  const bundled = getBundledSchemes();
  const sampleBase: GovernmentSchemeItem = bundled[0];

  await testCase('All bundled official portals pass strict HTTPS Pakistan gov/ZTBL domain allowlist', () => {
    assert.ok(bundled.length >= 5);
    for (const s of bundled) {
      assert.equal(
        isOfficialPakistanPortalUrl(s.officialPortal),
        true,
        `Unexpected unverified portal: ${s.officialPortal}`
      );
    }
  });

  await testCase('isOfficialPakistanPortalUrl rejects http, non-pk, and spoofed subdomains', () => {
    assert.equal(isOfficialPakistanPortalUrl('https://agripunjab.gov.pk/'), true);
    assert.equal(isOfficialPakistanPortalUrl('https://benazirharicard.gos.pk/'), true);
    assert.equal(isOfficialPakistanPortalUrl('https://www.ztbl.com.pk/'), true);
    assert.equal(isOfficialPakistanPortalUrl('http://agripunjab.gov.pk/'), false);
    assert.equal(isOfficialPakistanPortalUrl('https://gov.pk.evil-site.com/'), false);
    assert.equal(isOfficialPakistanPortalUrl('https://fake-subsidy-news.com/'), false);
    assert.equal(isOfficialPakistanPortalUrl('not-a-url'), false);
  });

  await testCase('isValidIsoDateString validates real calendar bounds', () => {
    assert.equal(isValidIsoDateString('2026-11-14'), true);
    assert.equal(isValidIsoDateString('2026-02-30'), false);
    assert.equal(isValidIsoDateString('14-11-2026'), false);
    assert.equal(isValidIsoDateString(null), false);
  });

  await testCase('getTodayPakistanIsoDate returns valid YYYY-MM-DD format', () => {
    const today = getTodayPakistanIsoDate();
    assert.equal(isValidIsoDateString(today), true);
  });

  await testCase('applySchemeExpiryRules auto-expires schemes whose deadline has passed cleanly and idempotently', () => {
    const expiredCandidate: GovernmentSchemeItem = {
      ...sampleBase,
      status: 'ongoing',
      expiresAt: '2020-01-15',
      datesNote: { en: 'Open until 2020-01-15.', ur: '2020-01-15 تک کھلی۔' },
    };

    const once = applySchemeExpiryRules(expiredCandidate, '2026-11-14');
    assert.equal(once.status, 'expired');
    assert.equal(once.expiredAutoDetected, true);
    assert.match(once.datesNote.en, /Auto-expired after deadline \(2020-01-15\)/);
    assert.match(once.datesNote.ur, /2020-01-15/);

    const twice = applySchemeExpiryRules(once, '2026-11-14');
    assert.equal(twice.datesNote.en, once.datesNote.en);
    assert.equal(twice.datesNote.ur, once.datesNote.ur);
  });

  await testCase('applySchemeExpiryRules keeps future/current-day deadlines active and never fabricates missing dates', () => {
    const futureActive = applySchemeExpiryRules(
      { ...sampleBase, status: 'ongoing', expiresAt: '2099-12-31' },
      '2026-11-14'
    );
    assert.equal(futureActive.status, 'ongoing');
    assert.equal(futureActive.expiredAutoDetected, false);

    const sameDayActive = applySchemeExpiryRules(
      { ...sampleBase, status: 'verify_on_portal', expiresAt: '2026-11-14' },
      '2026-11-14'
    );
    assert.equal(sameDayActive.status, 'verify_on_portal');
    assert.equal(sameDayActive.expiredAutoDetected, false);

    const undated = applySchemeExpiryRules(
      { ...sampleBase, status: 'verify_on_portal', expiresAt: undefined },
      '2026-11-14'
    );
    assert.equal(undated.expiresAt, undefined);
    assert.equal(undated.status, 'verify_on_portal');
  });

  await testCase('sortSchemesActiveFirst ranks ongoing -> verify_on_portal -> expired', () => {
    const list: GovernmentSchemeItem[] = [
      { ...sampleBase, id: 'c_exp', status: 'expired' },
      { ...sampleBase, id: 'b_ver', status: 'verify_on_portal' },
      { ...sampleBase, id: 'a_ong', status: 'ongoing' },
    ];
    const sorted = sortSchemesActiveFirst(list);
    assert.deepEqual(
      sorted.map((s) => s.id),
      ['a_ong', 'b_ver', 'c_exp']
    );
  });

  await testCase('isSchemesStateStale enforces 12-hour TTL', () => {
    const now = Date.parse('2026-11-14T12:00:00.000Z');
    assert.equal(isSchemesStateStale(null, now), true);
    assert.equal(
      isSchemesStateStale(new Date(now - 60_000).toISOString(), now),
      false
    );
    assert.equal(
      isSchemesStateStale(
        new Date(now - SCHEMES_AUTO_REFRESH_TTL_MS - 1).toISOString(),
        now
      ),
      true
    );
  });

  await testCase('Automated /api/schemes/refresh cron endpoint rejects unauthenticated callers cleanly', async () => {
    const prevCron = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = 'cron-secret-with-at-least-16-chars';
      const unauthCron = await schemesRefreshGet(
        new NextRequest('http://localhost/api/schemes/refresh', { method: 'GET' })
      );
      assert.equal(unauthCron.status, 401);
      assert.equal(unauthCron.headers.get('Cache-Control'), 'no-store, private');

      const badCron = await schemesRefreshGet(
        new NextRequest('http://localhost/api/schemes/refresh', {
          method: 'GET',
          headers: { Authorization: 'Bearer wrong-token' },
        })
      );
      assert.equal(badCron.status, 401);
    } finally {
      if (prevCron === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = prevCron;
      }
    }
  });

  await testCase('validateDiscoveredSchemeCandidate accepts real .gov.pk launches and rejects unofficial/duplicate/expired ones', () => {
    const validNew = validateDiscoveredSchemeCandidate(
      {
        id: 'balochistan_solar_agri_2027',
        titleEn: 'Balochistan Agricultural Tube-Well Solarization Program',
        titleUr: 'بلوچستان زرعی ٹیوب ویل سولرائزیشن پروگرام',
        province: 'Balochistan',
        department: 'Agriculture & Cooperatives Department Balochistan',
        officialPortal: 'https://balochistan.gov.pk/',
        status: 'ongoing',
        expiresAt: '2099-12-31',
        datesNoteEn: 'Open for registration on balochistan.gov.pk until 2099-12-31.',
        datesNoteUr: 'رجسٹریشن 2099-12-31 تک کھلی ہے۔',
        summaryEn: 'Solar conversion assistance for registered tube-wells in Balochistan.',
        summaryUr: 'بلوچستان کے کسانوں کے لیے زرعی ٹیوب ویل سولر اسکیم۔',
        eligibilityEn: ['Valid Balochistan CNIC & registered agricultural tube-well'],
        eligibilityUr: ['بلوچستان کا شناختی کارڈ اور رجسٹرڈ ٹیوب ویل'],
      },
      bundled,
      '2026-11-14'
    );
    assert.ok(validNew);
    assert.equal(validNew.autoDiscovered, true);
    assert.equal(validNew.province, 'Balochistan');

    // Reject unofficial domain
    const unofficial = validateDiscoveredSchemeCandidate(
      {
        id: 'fake_subsidy_scheme',
        titleEn: 'Fake Farmer Bonus',
        titleUr: 'جعلی بونس',
        province: 'National',
        department: 'Unofficial Blog',
        officialPortal: 'https://farmer-news-blog.com/',
        status: 'ongoing',
        datesNoteEn: 'Apply today.',
        datesNoteUr: 'آج اپلائی کریں۔',
        summaryEn: 'Unofficial scheme summary for testing.',
        summaryUr: 'ٹیسٹ خلاصہ۔',
        eligibilityEn: ['CNIC'],
        eligibilityUr: ['شناختی کارڈ'],
      },
      bundled,
      '2026-11-14'
    );
    assert.equal(unofficial, null);

    // Reject duplicate title against bundled catalog
    const duplicate = validateDiscoveredSchemeCandidate(
      {
        id: 'duplicate_kissan_card',
        titleEn: sampleBase.title.en,
        titleUr: sampleBase.title.ur,
        province: 'Punjab',
        department: 'Agriculture Department',
        officialPortal: 'https://agripunjab.gov.pk/',
        status: 'ongoing',
        datesNoteEn: 'Check portal.',
        datesNoteUr: 'پورٹل چیک کریں۔',
        summaryEn: 'Duplicate test summary.',
        summaryUr: 'نقل ٹیسٹ خلاصہ۔',
        eligibilityEn: ['CNIC'],
        eligibilityUr: ['شناختی کارڈ'],
      },
      bundled,
      '2026-11-14'
    );
    assert.equal(duplicate, null);

    // Reject already expired discovery
    const alreadyExpired = validateDiscoveredSchemeCandidate(
      {
        id: 'old_expired_scheme',
        titleEn: 'Old 2021 Seed Package',
        titleUr: 'پرانا بیج پیکج',
        province: 'Sindh',
        department: 'Agriculture Sindh',
        officialPortal: 'https://sindh.gov.pk/',
        status: 'ongoing',
        expiresAt: '2021-01-01',
        datesNoteEn: 'Closed in 2021.',
        datesNoteUr: '2021 میں بند۔',
        summaryEn: 'Expired test summary.',
        summaryUr: 'پرانا ٹیسٹ خلاصہ۔',
        eligibilityEn: ['CNIC'],
        eligibilityUr: ['شناختی کارڈ'],
      },
      bundled,
      '2026-11-14'
    );
    assert.equal(alreadyExpired, null);
  });

  await testCase('GET /api/schemes automatically expires past-deadline items and places them after active schemes', async () => {
    const tmpFile = path.join(os.tmpdir(), 'zarkhez-schemes-state.json');
    let backupTmp: string | null = null;
    try {
      backupTmp = await fs.readFile(tmpFile, 'utf8');
    } catch {
      backupTmp = null;
    }
    const prevMemory = (globalThis as Record<string, unknown>).__zarkhezSchemesState;

    try {
      const latestDiscovered = validateDiscoveredSchemeCandidate(
        {
          id: 'national_green_credit_2027',
          titleEn: 'National Green Agri Credit Line',
          titleUr: 'قومی گرین ایگری کریڈٹ لائن',
          province: 'National',
          department: 'State Bank / ZTBL',
          officialPortal: 'https://www.ztbl.com.pk/',
          status: 'ongoing',
          expiresAt: '2099-12-31',
          datesNoteEn: 'Applications open until 2099-12-31.',
          datesNoteUr: 'درخواستیں 2099-12-31 تک کھلی ہیں۔',
          summaryEn: 'Auto-discovered active federal farm credit facility.',
          summaryUr: 'وفاقی زرعی قرض سہولت۔',
          eligibilityEn: ['Registered Pakistani farmer with CNIC'],
          eligibilityUr: ['رجسٹرڈ پاکستانی کسان مع شناختی کارڈ'],
        },
        bundled,
        '2026-11-14'
      );
      assert.ok(latestDiscovered);

      // Seed state with one past-deadline scheme AND one auto-discovered latest scheme
      (globalThis as Record<string, unknown>).__zarkhezSchemesState = {
        lastAutoCheckAt: new Date().toISOString(),
        patches: {
          [sampleBase.id]: {
            id: sampleBase.id,
            status: 'ongoing',
            expiresAt: '2021-06-30',
            lastVerifiedAt: '2021-06-01',
          },
        },
        discoveredSchemes: [latestDiscovered],
      };

      const resGet = await schemesGet();
      assert.equal(resGet.status, 200);
      const getJson = (await resGet.json()) as { schemes: GovernmentSchemeItem[] };
      assert.equal(getJson.schemes[0].id, 'national_green_credit_2027');
      assert.equal(getJson.schemes[0].autoDiscovered, true);
      const fetchedTarget = getJson.schemes.find((s) => s.id === sampleBase.id);
      assert.ok(fetchedTarget);
      assert.equal(fetchedTarget.status, 'expired');
      assert.equal(fetchedTarget.expiredAutoDetected, true);
      assert.equal(getJson.schemes[getJson.schemes.length - 1].id, sampleBase.id);
    } finally {
      const pendingRefresh = (globalThis as Record<string, unknown>)
        .__zarkhezSchemesRefreshPromise as Promise<unknown> | undefined;
      if (pendingRefresh) {
        await pendingRefresh.catch(() => undefined);
      }
      (globalThis as Record<string, unknown>).__zarkhezSchemesState = prevMemory;
      if (backupTmp !== null) {
        await fs.writeFile(tmpFile, backupTmp, 'utf8');
      } else {
        await fs.unlink(tmpFile).catch(() => undefined);
      }
    }
  });

  console.log(`\nSchemes Suite Complete: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

void runTests();
