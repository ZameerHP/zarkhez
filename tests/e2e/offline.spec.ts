import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const TEST_PROFILE = {
  farmerId: 'ZRK-PK-884210',
  fullName: 'Muhammad Akram',
  fatherOrFarmName: 'Akram Farm',
  phone: '03001234567',
  villageOrTehsil: 'Chak 42',
  email: 'akram@zarkhez.pk',
  avatarUrl: '',
  placeName: 'Multan, Punjab',
  district: 'Multan',
  lat: 30.1575,
  lon: 71.5249,
  totalAcres: 5,
  primaryCrops: ['wheat', 'tomato'],
  language: 'en',
  preferredVoice: 'ur-PK-UzmaNeural',
  voiceSpeed: 1,
  autoSpeakVoice: false,
  onboardingDone: true,
  isAuthenticated: true,
  authProvider: 'google',
  createdAt: '2026-11-01T00:00:00.000Z',
};

async function authenticateFarmer(page: Page, context: BrowserContext, baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  await context.addCookies([
    {
      name: 'zarkhez_auth',
      value: '1',
      url: origin,
      sameSite: 'Lax',
    },
  ]);
  await page.addInitScript((profile) => {
    window.localStorage.setItem('zarkhez_persona_v2', JSON.stringify(profile));
  }, TEST_PROFILE);
}

// Draw a textured leaf with sharp midrib/veins + lesions so image-quality sharpness passes naturally
async function makeSyntheticLeafPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#d8dfd0';
    ctx.fillRect(0, 0, 240, 240);
    ctx.fillStyle = '#2d7a36';
    ctx.beginPath();
    ctx.ellipse(120, 120, 86, 58, 0.25, 0, Math.PI * 2);
    ctx.fill();
    // High-contrast veins & border strokes for natural Laplacian sharpness
    ctx.strokeStyle = '#97d488';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(42, 98);
    ctx.lineTo(198, 142);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      const cx = 120 + i * 20;
      const cy = 120 + i * 5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 12, cy - 28);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 10, cy + 28);
      ctx.stroke();
    }
    ctx.fillStyle = '#4e2f16';
    ctx.beginPath();
    ctx.arc(105, 115, 11, 0, Math.PI * 2);
    ctx.arc(145, 132, 8, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test.describe('ZARKHEZ Offline Upgrade & Zero-Regression E2E Verification', () => {
  test('1. Online preparation, Airplane Mode full usability, zero offline API leaks & reconnect', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(90000);
    const origin = baseURL || 'http://127.0.0.1:3000';
    await authenticateFarmer(page, context, origin);

    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${origin}/en/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    });

    for (const route of [
      '/en/weather',
      '/en/tools/fertilizer',
      '/en/schemes',
      '/en/assistant',
      '/en/scan',
      '/en/offline-center',
    ]) {
      await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
      await expect(page.locator('body')).toBeVisible();
    }

    // Prepare Essential Offline Pack
    await page.goto(`${origin}/en/offline-center`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Prepare \/ Refresh Essential Offline Pack/i }).click();
    await expect(page.getByText(/Essential Offline Pack ready/i)).toBeVisible({ timeout: 15000 });

    // Save a fertilizer plan offline into IndexedDB while online first
    await page.goto(`${origin}/en/tools/fertilizer`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Save Plan Offline/i }).click();
    await expect(page.getByRole('button', { name: /Saved Offline!/i })).toBeVisible();

    // Seed local cached weather snapshot cleanly for deterministic offline verification
    await page.evaluate(() => {
      const sampleWeather = {
        updatedAt: new Date().toISOString(),
        current: {
          temperature: 27,
          humidity: 42,
          precipitation: 0,
          windSpeed: 2.1,
          weatherCode: 1,
          soilTemperature: 23,
          soilMoisture: 28,
        },
        todaySunrise: '06:30',
        todaySunset: '17:20',
        daily: [
          {
            date: '2026-11-14',
            tempMax: 28,
            tempMin: 15,
            precipitationSum: 0,
            precipitationProbMax: 5,
            windSpeedMax: 2.4,
          },
        ],
        hourlySoil: [],
        alerts: [],
      };
      window.localStorage.setItem('zarkhez_last_weather_v1', JSON.stringify(sampleWeather));
    });

    // ---------------- SWITCH TO AIRPLANE MODE ----------------
    const offlineCloudApiCalls: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (
        url.includes('/api/chat') ||
        url.includes('/api/scan/analyze') ||
        url.includes('/api/tts') ||
        url.includes('/api/stt') ||
        url.includes('generativelanguage.googleapis.com')
      ) {
        offlineCloudApiCalls.push(url);
      }
    });

    // Start from warm /en/home so flipping Airplane Mode reflects true browser offline state
    await page.goto(`${origin}/en/home`, { waitUntil: 'networkidle' });
    await context.setOffline(true);
    consoleErrors.length = 0;

    // 1. Offline status indicator shows immediately & SPA Advisor navigation uses Offline KB with ZERO /api/chat leaks
    await expect(page.getByText(/^Offline/i).first()).toBeVisible({ timeout: 5000 });
    await page.locator('nav[aria-label="Primary Bottom Navigation"] a[href="/en/assistant"]').click();
    await expect(page).toHaveURL(/\/en\/assistant/, { timeout: 10000 });
    const input = page.locator('input[type="text"], textarea').first();
    await input.fill('wheat yellow rust');
    await input.press('Enter');
    await expect(page.getByText(/Offline Farming Guide \(Local KB/i).first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/Yellow Rust/i).first()).toBeVisible();

    // Verify ZERO forbidden cloud AI/TTS requests fired in Airplane Mode
    expect(offlineCloudApiCalls).toEqual([]);

    // 2. Cold offline Service Worker reloads work across Home, Schemes & Fertilizer
    await page.goto(`${origin}/en/home`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Assalam o Alaikum/i).first()).toBeVisible();

    await page.goto(`${origin}/en/schemes`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/CM Punjab Kissan Card/i)).toBeVisible();
    await page.getByRole('button', { name: 'Sindh' }).click();
    await expect(page.getByText(/Sindh Benazir Hari Card/i)).toBeVisible();

    await page.goto(`${origin}/en/tools/fertilizer`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Growth-Stage Split Schedule/i)).toBeVisible();
    await expect(page.getByText(/Saved Offline Fertilizer Plans/i)).toBeVisible();

    // 3. Verify IndexedDB v3 migrated cleanly with zero 'mandiCache' object store
    const hasMandiStore = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('zarkhez_offline_v2');
        req.onsuccess = () => {
          const db = req.result;
          const exists = db.objectStoreNames.contains('mandiCache');
          db.close();
          resolve(exists);
        };
        req.onerror = () => resolve(false);
      });
    });
    expect(hasMandiStore).toBe(false);

    // Verify no uncaught JS page errors during offline flows
    const fatalOfflineErrors = consoleErrors.filter(
      (msg) => !msg.includes('Failed to fetch') && !msg.includes('net::ERR_INTERNET_DISCONNECTED')
    );
    expect(fatalOfflineErrors).toEqual([]);

    // ---------------- INTERNET RETURNS ----------------
    await context.setOffline(false);
    await page.goto(`${origin}/en/offline-center`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Connected Online/i)).toBeVisible({ timeout: 10000 });
  });

  test('2. Real On-Device ONNX model download, SHA-256 verification, offline worker inference & crop support guardrail', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120000);
    const origin = baseURL || 'http://127.0.0.1:3000';
    await authenticateFarmer(page, context, origin);

    await page.goto(`${origin}/en/offline-center`, { waitUntil: 'networkidle' });
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg.active);
    });

    // Trigger real opt-in ONNX download & SHA-256 verification
    await page.getByRole('button', { name: /Download Offline Vision AI/i }).click();
    await expect(page.getByText(/Installed & SHA-256 Verified/i)).toBeVisible({
      timeout: 60000,
    });

    // Warm /en/scan shell while online
    await page.goto(`${origin}/en/scan`, { waitUntil: 'networkidle' });
    const pngBuffer = await makeSyntheticLeafPng(page);

    // Go completely offline while already on /en/scan so navigator.onLine reflects true Airplane Mode
    const cloudScanRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/scan/analyze')) cloudScanRequests.push(req.url());
    });
    await context.setOffline(true);

    // Test A: Supported crop (Tomato) triggers real ONNX Web Worker execution offline with 0 /api/scan/analyze requests
    await page.getByRole('button', { name: /Tomato/i }).click();

    const fileInput = page.locator('input[type="file"]').nth(1);
    await fileInput.setInputFiles({
      name: 'leaf-tomato.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    // Wait properly for either quality warning bypass button or direct ONNX offline button
    const bypassBtn = page.getByRole('button', { name: /Use Anyway/i }).first();
    const onnxBtn = page.getByRole('button', { name: /Run On-Device Offline AI Scan \(ONNX\)/i });
    const winner = await Promise.race([
      bypassBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'bypass' as const),
      onnxBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'onnx' as const),
    ]).catch(() => null);
    if (winner === 'bypass') {
      await bypassBtn.click();
    }

    await expect(onnxBtn).toBeVisible({ timeout: 10000 });
    await onnxBtn.click();

    // Either reaches calibrated local confidence threshold OR returns honest low-confidence ONNX report
    const onnxBanner = page
      .getByText(/MobileNetV2-1\.0-224 INT8 ONNX|On-device ONNX|local model/i)
      .first();
    await expect(onnxBanner).toBeVisible({ timeout: 25000 });

    // Confirm ZERO network scan requests attempted offline
    expect(cloudScanRequests).toEqual([]);

    // Test B: Cold offline /en/scan reload works via SW, and Wheat enforces honest crop-support guardrail
    await page.goto(`${origin}/en/scan`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Smart Crop Scanner/i })).toBeVisible();
    await context.setOffline(false);
    await context.setOffline(true);
    await page.getByRole('button', { name: /Wheat/i }).click();
    await fileInput.setInputFiles({
      name: 'leaf-wheat.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });
    const prelimBtn = page.getByRole('button', { name: /View Offline Preliminary Check/i });
    const wheatWinner = await Promise.race([
      bypassBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'bypass' as const),
      prelimBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => 'prelim' as const),
    ]).catch(() => null);
    if (wheatWinner === 'bypass') {
      await bypassBtn.click();
    }
    await expect(prelimBtn).toBeVisible({ timeout: 10000 });
    await prelimBtn.click();
    await expect(page.getByText(/not covered offline yet/i).first()).toBeVisible({ timeout: 10000 });
    expect(cloudScanRequests).toEqual([]);

    // Cleanup installed model before ending test so repeat runs start clean
    await context.setOffline(false);
    await page.goto(`${origin}/en/offline-center`, { waitUntil: 'networkidle' });
    const delBtn = page.getByRole('button', { name: /^Delete$/i });
    if (await delBtn.isVisible().catch(() => false)) {
      await delBtn.click();
    }
  });
});
