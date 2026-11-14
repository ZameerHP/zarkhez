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
} from '../lib/server/schemes-store';
import { GET as schemesGet, POST as schemesPost } from '../app/api/schemes/route';
import {
  GET as schemesRefreshGet,
  POST as schemesRefreshPost,
} from '../app/api/schemes/refresh/route';

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

  console.log('\n=== Schemes Auto-Expiry & Auto-Update Suite ===');

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

  await testCase('Protected /api/schemes & /api/schemes/refresh mutations reject unauthorized callers cleanly', async () => {
    const unauthPost = await schemesPost(
      new NextRequest('http://localhost/api/schemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sampleBase.id, status: 'expired' }),
      })
    );
    assert.equal(unauthPost.status, 401);
    assert.equal(unauthPost.headers.get('Cache-Control'), 'no-store, private');

    const unauthCron = await schemesRefreshGet(
      new NextRequest('http://localhost/api/schemes/refresh', { method: 'GET' })
    );
    assert.equal(unauthCron.status, 401);

    const unauthRefreshPost = await schemesRefreshPost(
      new NextRequest('http://localhost/api/schemes/refresh', { method: 'POST' })
    );
    assert.equal(unauthRefreshPost.status, 401);
  });

  await testCase('Authorized POST /api/schemes auto-expires past deadlines and GET /api/schemes serves updated list', async () => {
    const tmpFile = path.join(os.tmpdir(), 'zarkhez-schemes-state.json');
    const prevSecret = process.env.ADMIN_DIAGNOSTICS_SECRET;
    let backupTmp: string | null = null;
    try {
      backupTmp = await fs.readFile(tmpFile, 'utf8');
    } catch {
      backupTmp = null;
    }
    const prevMemory = (globalThis as Record<string, unknown>).__zarkhezSchemesState;

    try {
      process.env.ADMIN_DIAGNOSTICS_SECRET = 'test-admin-secret-at-least-16-chars';

      const resSave = await schemesPost(
        new NextRequest('http://localhost/api/schemes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': 'test-admin-secret-at-least-16-chars',
          },
          body: JSON.stringify({
            id: sampleBase.id,
            status: 'ongoing',
            expiresAt: '2021-06-30',
            verifiedBy: 'Automated Test Runner',
          }),
        })
      );
      assert.equal(resSave.status, 200);
      const saveJson = (await resSave.json()) as {
        ok: boolean;
        updatedScheme: GovernmentSchemeItem;
      };
      assert.equal(saveJson.ok, true);
      assert.equal(saveJson.updatedScheme.status, 'expired');
      assert.equal(saveJson.updatedScheme.expiredAutoDetected, true);

      const resGet = await schemesGet();
      assert.equal(resGet.status, 200);
      const getJson = (await resGet.json()) as { schemes: GovernmentSchemeItem[] };
      const fetchedTarget = getJson.schemes.find((s) => s.id === sampleBase.id);
      assert.ok(fetchedTarget);
      assert.equal(fetchedTarget.status, 'expired');
      // Expired item must be placed after non-expired items
      assert.equal(getJson.schemes[getJson.schemes.length - 1].id, sampleBase.id);
    } finally {
      const pendingRefresh = (globalThis as Record<string, unknown>)
        .__zarkhezSchemesRefreshPromise as Promise<unknown> | undefined;
      if (pendingRefresh) {
        await pendingRefresh.catch(() => undefined);
      }
      if (prevSecret === undefined) {
        delete process.env.ADMIN_DIAGNOSTICS_SECRET;
      } else {
        process.env.ADMIN_DIAGNOSTICS_SECRET = prevSecret;
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
