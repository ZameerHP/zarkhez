import { test, expect, type Page } from '@playwright/test';

const TEST_PROFILE = {
  farmerId: 'ZRK-PK-884422',
  fullName: 'Muhammad Akram',
  fatherOrFarmName: 'Al-Noor Wheat Farm',
  email: 'akram.farmer@zarkhez.pk',
  phone: '0300-1234567',
  district: 'Faisalabad',
  province: 'Punjab',
  villageOrTehsil: 'Chak 45/12-L',
  placeName: 'Faisalabad, Punjab',
  lat: 31.418,
  lon: 73.079,
  totalAcres: 12,
  landAcresBand: '5-12',
  primaryCrops: ['wheat', 'cotton', 'rice'],
  mainCrops: ['wheat', 'cotton', 'rice'],
  avatarUrl: '',
  authProvider: 'email' as const,
  isAuthenticated: true,
  language: 'en' as const,
  autoSpeakVoice: false,
  preferredVoice: 'ur-PK-UzmaNeural',
  voiceSpeed: 1,
  onboardingDone: true,
  joinedAt: '2026',
};

const PORTRAIT_VIEWPORTS = [
  { name: '320x568 (Small Phone)', width: 320, height: 568 },
  { name: '360x800 (Small Android)', width: 360, height: 800 },
  { name: '375x812 (Standard iPhone)', width: 375, height: 812 },
  { name: '390x844 (iPhone 14)', width: 390, height: 844 },
  { name: '393x873 (Pixel / Standard Android)', width: 393, height: 873 },
  { name: '414x896 (Large Phone)', width: 414, height: 896 },
  { name: '430x932 (Pro Max)', width: 430, height: 932 },
  { name: '768x1024 (Tablet)', width: 768, height: 1024 },
];

const LANDSCAPE_VIEWPORTS = [
  { name: '568x320 (Small Landscape)', width: 568, height: 320 },
  { name: '844x390 (Phone Landscape)', width: 844, height: 390 },
];

const MOCK_WEATHER = {
  current: {
    temperature: 29,
    humidity: 44,
    precipitation: 0,
    windSpeed: 2.3,
    weatherCode: 1,
    soilTemperature: 26,
    soilMoisture: 24,
  },
  todaySunrise: '06:25',
  todaySunset: '17:15',
  updatedAt: '2026-11-13T10:00:00.000Z',
  alerts: [],
  daily: [
    { date: '2026-11-13', tempMax: 30, tempMin: 16, precipitationProbMax: 10, precipitationSum: 0, windSpeedMax: 3.1 },
    { date: '2026-11-14', tempMax: 29, tempMin: 15, precipitationProbMax: 15, precipitationSum: 0, windSpeedMax: 2.8 },
    { date: '2026-11-15', tempMax: 28, tempMin: 14, precipitationProbMax: 20, precipitationSum: 1, windSpeedMax: 3.4 },
    { date: '2026-11-16', tempMax: 31, tempMin: 16, precipitationProbMax: 5, precipitationSum: 0, windSpeedMax: 2.1 },
  ],
  hourlySoil: [
    { time: '2026-11-13T09:00', soilTemp0cm: 24, soilMoisture0to1cm: 0.24 },
    { time: '2026-11-13T12:00', soilTemp0cm: 28, soilMoisture0to1cm: 0.22 },
    { time: '2026-11-13T15:00', soilTemp0cm: 29, soilMoisture0to1cm: 0.21 },
  ],
};

async function setupFarmerSession(page: Page, locale: 'en' | 'ur' = 'en') {
  await page.route('**/api/weather**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_WEATHER),
    });
  });

  await page.addInitScript(
    ({ profile, loc }) => {
      const p = { ...profile, language: loc };
      window.localStorage.setItem('zarkhez_persona_v2', JSON.stringify(p));
      window.localStorage.setItem(
        'zarkhez_registered_accounts_v2',
        JSON.stringify([p])
      );
      window.localStorage.setItem(
        'zarkhez_real_fields_v2',
        JSON.stringify([
          {
            id: 'field-test-1',
            name: 'North Wheat Plot',
            crop: 'wheat',
            area_acres: 6,
            soil_type: 'medium',
            sowing_date: '2026-11-01',
            completedTaskIds: [],
          },
        ])
      );
      window.localStorage.setItem(
        'zarkhez_real_diary_v2',
        JSON.stringify([
          {
            id: 'diary-1',
            kind: 'expense',
            category: 'Fertilizer',
            amount: 12500,
            note: 'DAP and Urea application',
            entry_date: '2026-11-10',
            created_at: '2026-11-10T09:00:00.000Z',
          },
        ])
      );
      window.sessionStorage.setItem('zarkhez_splash_seen_v1', '1');
    },
    { profile: TEST_PROFILE, loc: locale }
  );
}

async function auditLayoutInvariants(page: Page, routePath: string, vpName: string) {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docScrollW = document.documentElement.scrollWidth;
    const bodyScrollW = document.body.scrollWidth;

    const metaViewport =
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';

    const htmlTouchAction = getComputedStyle(document.documentElement).touchAction;
    const bodyTouchAction = getComputedStyle(document.body).touchAction;

    // 1. Check horizontal bleeds outside [0..vw], ignoring intentional scrollable strips & Recharts SVGs
    const overflowingElements: string[] = [];
    const nodes = document.querySelectorAll(
      'header, main, section, nav, footer, h1, h2, h3, button, a, input, select, textarea'
    );
    for (const el of Array.from(nodes)) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        continue;
      }
      // Skip elements inside intentional horizontal scroll containers
      const insideHScroll = el.closest('.overflow-x-auto, [class*="overflow-x-auto"]');
      if (insideHScroll && el !== insideHScroll) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      if (rect.right > vw + 2 || rect.left < -2) {
        const tag = el.tagName.toLowerCase();
        const label =
          (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32);
        overflowingElements.push(
          `${tag}[${label}] left=${Math.round(rect.left)} right=${Math.round(rect.right)} vw=${vw}`
        );
      }
    }

    // 2. Check form controls have >= 16px computed font size on mobile (< 768px) to prevent iOS focus zoom
    const smallInputs: string[] = [];
    if (vw < 768) {
      const formControls = document.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), select, textarea'
      );
      for (const el of Array.from(formControls)) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const fs = parseFloat(style.fontSize);
        if (fs < 15.9) {
          smallInputs.push(`${el.tagName.toLowerCase()}:${fs}px`);
        }
      }
    }

    // 3. Check BottomNav tabs do not overlap or collapse if BottomNav is present
    const nav = document.querySelector('nav[aria-label="Primary Bottom Navigation"]');
    const navIssues: string[] = [];
    if (nav) {
      const navLinks = Array.from(nav.querySelectorAll('a'));
      const rects = navLinks.map((a) => ({
        text: (a.textContent || '').trim(),
        r: a.getBoundingClientRect(),
      }));
      for (let i = 0; i < rects.length; i++) {
        if (rects[i].r.width < 32 || rects[i].r.height < 40) {
          navIssues.push(`tab-too-small:${rects[i].text}:${Math.round(rects[i].r.width)}x${Math.round(rects[i].r.height)}`);
        }
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].r;
          const b = rects[j].r;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) {
            navIssues.push(`tab-overlap:${rects[i].text}/${rects[j].text}`);
          }
        }
      }
    }

    // 4. Check header buttons do not collide/overlap horizontally
    const header = document.querySelector('header');
    const headerIssues: string[] = [];
    if (header) {
      const hdrRect = header.getBoundingClientRect();
      if (hdrRect.right > vw + 2 || hdrRect.left < -2) {
        headerIssues.push(`header-bleed:${Math.round(hdrRect.left)}..${Math.round(hdrRect.right)}`);
      }
      const controls = Array.from(header.querySelectorAll('a, button')).filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      });
      for (let i = 0; i < controls.length; i++) {
        const a = controls[i].getBoundingClientRect();
        for (let j = i + 1; j < controls.length; j++) {
          const b = controls[j].getBoundingClientRect();
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 3 && overlapY > 3) {
            headerIssues.push(
              `hdr-overlap:${controls[i].textContent?.trim().slice(0, 12)}/${controls[j].textContent?.trim().slice(0, 12)}`
            );
          }
        }
      }
    }

    // 5. Check visible <img> loaded cleanly without broken 0px width
    const brokenImages: string[] = [];
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const style = getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (img.complete && img.naturalWidth === 0) {
        brokenImages.push(img.getAttribute('src') || 'img');
      }
    }

    return {
      vw,
      vh,
      docScrollW,
      bodyScrollW,
      metaViewport,
      htmlTouchAction,
      bodyTouchAction,
      overflowingElements,
      smallInputs,
      navIssues,
      headerIssues,
      brokenImages,
      scale: window.visualViewport?.scale ?? 1,
    };
  });

  expect(report.metaViewport, `${routePath} (${vpName}) viewport meta`).toContain('user-scalable=no');
  expect(report.metaViewport, `${routePath} (${vpName}) max scale`).toContain('maximum-scale=1');
  expect(report.metaViewport, `${routePath} (${vpName}) viewport-fit`).toContain('viewport-fit=cover');
  expect(report.htmlTouchAction, `${routePath} (${vpName}) html touchAction`).not.toContain('pinch-zoom');
  expect(report.bodyTouchAction, `${routePath} (${vpName}) body touchAction`).not.toContain('pinch-zoom');
  expect(report.scale, `${routePath} (${vpName}) visualViewport scale`).toBe(1);
  expect(report.docScrollW, `${routePath} (${vpName}) document scrollWidth <= vw`).toBeLessThanOrEqual(
    report.vw + 1
  );
  expect(report.bodyScrollW, `${routePath} (${vpName}) body scrollWidth <= vw`).toBeLessThanOrEqual(
    report.vw + 1
  );
  expect(report.overflowingElements, `${routePath} (${vpName}) horizontal bleeds`).toEqual([]);
  expect(report.smallInputs, `${routePath} (${vpName}) inputs < 16px`).toEqual([]);
  expect(report.navIssues, `${routePath} (${vpName}) BottomNav issues`).toEqual([]);
  expect(report.headerIssues, `${routePath} (${vpName}) Header overlap/bleed`).toEqual([]);
  expect(report.brokenImages, `${routePath} (${vpName}) Broken images`).toEqual([]);
}

test.describe('Zarkhez Responsive & PWA Zoom Audit', () => {
  test('disables pinch, gesture, ctrl+wheel, and background double-tap zoom while preserving normal taps & scrolling', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await setupFarmerSession(page, 'en');
    await page.goto('/en/home', { waitUntil: 'load' });
    await page.waitForSelector('header, main', { state: 'visible' });

    const gestureResults = await page.evaluate(() => {
      // 1. Ctrl+wheel zoom event must be prevented
      const wheelEvent = new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(wheelEvent);

      // 2. Normal wheel scroll (without ctrlKey) must NOT be prevented
      const normalWheel = new WheelEvent('wheel', {
        deltaY: 120,
        ctrlKey: false,
        cancelable: true,
        bubbles: true,
      });
      window.dispatchEvent(normalWheel);

      // 3. WebKit gesturestart must be prevented
      const gestureEvent = new Event('gesturestart', { cancelable: true, bubbles: true });
      document.dispatchEvent(gestureEvent);

      // 4. Multi-touch pinch (2 touches) must be prevented, single touch must NOT be prevented
      const mkTouch = (id: number, x: number, y: number) =>
        new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });

      const multiTouch = new TouchEvent('touchstart', {
        touches: [mkTouch(1, 100, 200), mkTouch(2, 220, 320)],
        changedTouches: [mkTouch(2, 220, 320)],
        cancelable: true,
        bubbles: true,
      });
      document.body.dispatchEvent(multiTouch);

      const singleTouch = new TouchEvent('touchstart', {
        touches: [mkTouch(3, 150, 250)],
        changedTouches: [mkTouch(3, 150, 250)],
        cancelable: true,
        bubbles: true,
      });
      document.body.dispatchEvent(singleTouch);

      // 5. Text selection check (paragraph text should still be selectable)
      const p = document.querySelector('p, h1');
      const userSelect = p ? getComputedStyle(p).userSelect : 'auto';

      return {
        ctrlWheelPrevented: wheelEvent.defaultPrevented,
        normalWheelPrevented: normalWheel.defaultPrevented,
        gesturePrevented: gestureEvent.defaultPrevented,
        multiTouchPrevented: multiTouch.defaultPrevented,
        singleTouchPrevented: singleTouch.defaultPrevented,
        userSelect,
      };
    });

    expect(gestureResults.ctrlWheelPrevented).toBe(true);
    expect(gestureResults.normalWheelPrevented).toBe(false);
    expect(gestureResults.gesturePrevented).toBe(true);
    expect(gestureResults.multiTouchPrevented).toBe(true);
    expect(gestureResults.singleTouchPrevented).toBe(false);
    expect(gestureResults.userSelect).not.toBe('none');

    await context.close();
  });

  for (const vp of PORTRAIT_VIEWPORTS) {
    test(`all pages pass layout audit at portrait ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: vp.width < 768,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      // Public Login / Welcome route (EN & UR)
      await page.goto('/en', { waitUntil: 'load' });
      await page.waitForSelector('main', { state: 'visible' });
      await page.waitForTimeout(120);
      await auditLayoutInvariants(page, '/en', vp.name);

      await page.goto('/ur', { waitUntil: 'load' });
      await page.waitForSelector('main', { state: 'visible' });
      await page.waitForTimeout(120);
      await auditLayoutInvariants(page, '/ur', vp.name);

      // Authenticated App Screens
      await setupFarmerSession(page, 'en');
      const routes = [
        '/en/home',
        '/ur/home',
        '/en/scan',
        '/ur/scan',
        '/en/assistant',
        '/ur/assistant',
        '/en/weather',
        '/en/crop/wheat',
        '/en/diary',
        '/en/profile',
        '/en/tools/calendar',
        '/en/tools/fertilizer',
      ];

      for (const route of routes) {
        await page.goto(route, { waitUntil: 'load' });
        await page.waitForSelector('header, main', { state: 'visible' });
        await page.waitForTimeout(140);
        await auditLayoutInvariants(page, route, vp.name);
      }

      expect(errors).toEqual([]);
      await context.close();
    });
  }

  for (const vp of LANDSCAPE_VIEWPORTS) {
    test(`core screens & modals fit cleanly in landscape ${vp.name}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await setupFarmerSession(page, 'en');
      const routes = [
        '/en',
        '/en/home',
        '/en/scan',
        '/en/assistant',
        '/en/weather',
        '/en/crop/wheat',
        '/en/diary',
        '/en/profile',
      ];

      for (const route of routes) {
        await page.goto(route, { waitUntil: 'load' });
        await page.waitForSelector('header, main', { state: 'visible' });
        await page.waitForTimeout(140);
        await auditLayoutInvariants(page, route, vp.name);
      }

      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test('modals, dropdowns, BottomNav navigation, and standalone mode behave properly at 320x568 and 568x320', async ({
    browser,
  }) => {
    for (const vp of [
      { width: 320, height: 568 },
      { width: 568, height: 320 },
      { width: 768, height: 1024 },
    ]) {
      const context = await browser.newContext({
        viewport: vp,
        hasTouch: true,
        isMobile: vp.width < 768,
      });
      const page = await context.newPage();
      await setupFarmerSession(page, 'en');

      // Mark standalone mode
      await page.addInitScript(() => {
        document.documentElement.setAttribute('data-zk-standalone', '1');
      });

      // 1. Home modals (Change Location + Add Field)
      await page.goto('/en/home', { waitUntil: 'load' });
      await page.waitForSelector('main', { state: 'visible' });
      await page.getByText(/Change Location/i).click();
      await page.waitForSelector('input[type="text"]');
      await auditLayoutInvariants(page, '/en/home (LocationPicker)', `${vp.width}x${vp.height}`);
      await page.getByLabel('Close').click();

      await page.getByRole('button', { name: /Add Field/i }).first().click();
      await page.waitForSelector('input[placeholder*="North Plot"]');
      await auditLayoutInvariants(page, '/en/home (AddFieldModal)', `${vp.width}x${vp.height}`);
      await page.getByRole('button', { name: /Cancel/i }).click();

      // 2. Navigate via BottomNav tabs (no crash / full reload)
      await page.locator('nav[aria-label="Primary Bottom Navigation"] a[href*="/diary"]').click();
      await page.waitForURL('**/diary');
      await page.waitForSelector('main', { state: 'visible' });
      await page.getByLabel(/Add/i).click();
      await page.waitForSelector('textarea');
      await auditLayoutInvariants(page, '/en/diary (AddEntryModal)', `${vp.width}x${vp.height}`);
      await page.getByRole('button', { name: /Cancel/i }).click();

      // 3. Assistant chat input clearance & focus without zoom
      await page.locator('nav[aria-label="Primary Bottom Navigation"] a[href*="/assistant"]').click();
      await page.waitForURL('**/assistant');
      await page.waitForSelector('form input', { state: 'visible' });
      const chatInput = page.locator('form input').last();
      await chatInput.scrollIntoViewIfNeeded();
      await chatInput.click();
      await chatInput.fill('Wheat irrigation schedule');
      await auditLayoutInvariants(page, '/en/assistant (InputFocused)', `${vp.width}x${vp.height}`);

      // 4. Profile Personal Info form & Delete Confirm modal
      await page.locator('nav[aria-label="Primary Bottom Navigation"] a[href*="/profile"]').click();
      await page.waitForURL('**/profile');
      await page.waitForSelector('main', { state: 'visible' });
      const personalBtn = page.getByRole('button', { name: /Personal Info/i });
      if (await personalBtn.isVisible()) {
        await personalBtn.click();
        await page.waitForSelector('input[required]');
        await auditLayoutInvariants(page, '/en/profile (EditingForm)', `${vp.width}x${vp.height}`);
      }
      const deleteBtn = page.getByRole('button', { name: /Delete/i }).first();
      await deleteBtn.scrollIntoViewIfNeeded();
      await deleteBtn.click();
      await page.getByRole('button', { name: /Yes, Delete All/i }).waitFor({ state: 'visible' });
      await auditLayoutInvariants(page, '/en/profile (DeleteConfirmModal)', `${vp.width}x${vp.height}`);
      await page.getByRole('button', { name: /Cancel/i }).last().click();

      // 5. Offline fallback page layout
      await page.goto('/offline.html', { waitUntil: 'load' });
      const offlineScrollW = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        mv: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '',
      }));
      expect(offlineScrollW.sw).toBeLessThanOrEqual(offlineScrollW.vw + 1);
      expect(offlineScrollW.mv).toContain('user-scalable=no');

      await context.close();

      // 6. Fresh guest context: Sign Up tab + OnboardingModal layout at this viewport
      const guestCtx = await browser.newContext({
        viewport: vp,
        hasTouch: true,
        isMobile: vp.width < 768,
      });
      const guestPage = await guestCtx.newPage();
      await guestPage.goto('/en', { waitUntil: 'load' });
      await guestPage.waitForSelector('main', { state: 'visible' });
      await guestPage.getByRole('button', { name: /Sign Up/i }).click();
      await guestPage.waitForTimeout(150);
      await auditLayoutInvariants(guestPage, '/en (SignUpForm)', `${vp.width}x${vp.height}`);
      await guestPage.locator('input[type="email"]').fill(`farmer_${vp.width}@zarkhez.pk`);
      await guestPage.getByRole('button', { name: /Create Account/i }).click();
      await guestPage.getByText(/Step 1 of 4/i).waitFor({ state: 'visible' });
      await auditLayoutInvariants(guestPage, '/en (OnboardingModal)', `${vp.width}x${vp.height}`);
      await guestCtx.close();
    }
  });

  test('laptop/desktop viewport keeps compact 480px centered shell without stretching wide', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();
    await setupFarmerSession(page, 'en');

    await page.goto('/en/home', { waitUntil: 'load' });
    await page.waitForSelector('header', { state: 'visible' });
    await auditLayoutInvariants(page, '/en/home', '1366x768 (Laptop)');

    const dims = await page.evaluate(() => {
      const header = document.querySelector('header')?.getBoundingClientRect();
      const navInner = document.querySelector(
        'nav[aria-label="Primary Bottom Navigation"] > div'
      )?.getBoundingClientRect();
      return {
        headerWidth: header ? Math.round(header.width) : 0,
        navWidth: navInner ? Math.round(navInner.width) : 0,
      };
    });

    expect(dims.headerWidth).toBeLessThanOrEqual(480);
    expect(dims.headerWidth).toBeGreaterThanOrEqual(400);
    expect(dims.navWidth).toBeLessThanOrEqual(450);

    await context.close();
  });
});
