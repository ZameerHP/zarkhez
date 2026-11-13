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
  primaryCrops: ['wheat'],
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

test.describe('ZARKHEZ Production PWA Verification', () => {
  test('1. Manifest, icons, SW headers, and offline page are valid and accessible', async ({
    request,
  }) => {
    const manifestRes = await request.get('/manifest.json');
    expect(manifestRes.status()).toBe(200);
    expect(manifestRes.headers()['content-type']).toMatch(/application\/(manifest\+)?json/i);

    const manifest = await manifestRes.json();
    expect(manifest.name).toBe('ZARKHEZ');
    expect(manifest.short_name).toBe('ZARKHEZ');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.theme_color).toBe('#062409');
    expect(manifest.background_color).toBeTruthy();

    const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toContain('192x192:any');
    expect(sizes).toContain('512x512:any');
    expect(sizes).toContain('192x192:maskable');
    expect(sizes).toContain('512x512:maskable');

    for (const icon of manifest.icons as Array<{ src: string }>) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status(), `Icon ${icon.src} should load`).toBe(200);
      expect(iconRes.headers()['content-type']).toContain('image/png');
      const body = await iconRes.body();
      expect(body.length).toBeGreaterThan(1000);
    }

    const swRes = await request.get('/sw.js');
    expect(swRes.status()).toBe(200);
    expect(swRes.headers()['cache-control']).toContain('no-store');
    expect(swRes.headers()['service-worker-allowed']).toBe('/');

    const offlineRes = await request.get('/offline.html');
    expect(offlineRes.status()).toBe(200);
    const offlineHtml = await offlineRes.text();
    expect(offlineHtml).toContain('ZARKHEZ');
    expect(offlineHtml).toContain('انٹرنیٹ دستیاب نہیں');
    expect(offlineHtml).toContain('انٽرنيٽ ڪونهي');
  });

  test('2. Service worker activates, cleans legacy cache, and never caches API or admin routes', async ({
    page,
    context,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await authenticateFarmer(page, context, baseURL!);
    // Seed a legacy cache on the origin before the new SW activates
    await page.goto('/offline.html');
    await page.evaluate(async () => {
      await caches.open('zarkhez-legacy-v1');
    });

    await page.goto('/en/home');

    // Wait for service worker to register and become active
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false, active: false };
      const reg = await navigator.serviceWorker.ready;
      return {
        supported: true,
        active: Boolean(reg.active),
        scope: reg.scope,
      };
    });

    expect(swState.supported).toBe(true);
    expect(swState.active).toBe(true);

    // Wait for activate cleanup of legacy zarkhez-* caches
    await expect
      .poll(async () => {
        const names = await page.evaluate(() => caches.keys());
        return names.includes('zarkhez-legacy-v1');
      })
      .toBe(false);

    // Trigger an API call and check Cache Storage never contains /api/ or /admin
    await page.evaluate(() => fetch('/api/geocode?q=Multan').catch(() => null));
    await page.waitForTimeout(1600);

    const cacheAudit = await page.evaluate(async () => {
      const names = await caches.keys();
      const allUrls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        const reqs = await cache.keys();
        for (const r of reqs) allUrls.push(r.url);
      }
      return { names, allUrls };
    });

    expect(cacheAudit.allUrls.some((u) => u.includes('/offline.html'))).toBe(true);
    expect(cacheAudit.allUrls.some((u) => u.includes('/api/'))).toBe(false);
    expect(cacheAudit.allUrls.some((u) => u.includes('/admin'))).toBe(false);
    expect(errors).toEqual([]);
  });

  test('3. Install Experience: beforeinstallprompt triggers install & hides button after install; fallback shows instructions', async ({
    page,
    context,
    baseURL,
  }) => {
    await authenticateFarmer(page, context, baseURL!);

    // Part A: Supported browser with beforeinstallprompt
    await page.goto('/en/profile');
    await page.evaluate(() => {
      let promptCalls = 0;
      (window as unknown as { __promptCalls?: () => number }).__promptCalls = () => promptCalls;
      const evt = new Event('beforeinstallprompt') as Event & {
        platforms: string[];
        userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
        prompt: () => Promise<void>;
      };
      evt.platforms = ['web'];
      evt.prompt = async () => {
        promptCalls++;
      };
      evt.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(evt);
    });

    const installBtn = page.getByRole('button', { name: /Install App/i });
    await expect(installBtn).toBeVisible();
    await installBtn.click();

    // After accepting install, Install App button disappears and "App installed" is shown
    await expect(installBtn).toBeHidden();
    await expect(page.getByText(/App installed/i)).toBeVisible();

    // Part B: Unsupported browser without beforeinstallprompt shows instructions sheet
    await page.evaluate(() => {
      window.localStorage.removeItem('zarkhez_pwa_installed');
    });
    await page.reload();
    const fallbackInstallBtn = page.getByRole('button', { name: /Install App/i });
    await expect(fallbackInstallBtn).toBeVisible();
    await fallbackInstallBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/How to install/i)).toBeVisible();
  });

  test('4. Standalone launch mode shows branded splash and hides it cleanly without blocking UI', async ({
    page,
    context,
    baseURL,
  }) => {
    await authenticateFarmer(page, context, baseURL!);
    await page.addInitScript(() => {
      const origMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => {
        if (query === '(display-mode: standalone)') {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return origMatchMedia(query);
      }) as typeof window.matchMedia;
    });

    await page.goto('/en/home');
    await expect(page.locator('html')).toHaveAttribute('data-zk-standalone', '1');
    // Splash transitions to done after hydration fade-out
    await expect(page.locator('html')).toHaveAttribute('data-zk-splash', 'done', { timeout: 5000 });
    // Install button must remain hidden when running standalone
    await page.goto('/en/profile');
    await expect(page.getByRole('button', { name: /Install App/i })).toHaveCount(0);
    await expect(page.getByText(/App installed/i)).toBeVisible();
  });

  test('5. Offline behavior: warmed pages work, API features show offline errors, uncached route shows branded offline page', async ({
    page,
    context,
    baseURL,
  }) => {
    await authenticateFarmer(page, context, baseURL!);
    await page.goto('/en/home');

    // Wait for SW ready + background WARM_SHELL
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.waitForTimeout(2500);

    // Go offline while on Home -> offline banner appears and persists across client navigation
    await context.setOffline(true);
    await expect(page.getByText(/You are offline/i)).toBeVisible();

    // Navigate offline via BottomNav to AI Assistant (pre-warmed shell)
    await page.getByRole('link', { name: /Advisor/i }).click();
    await expect(page).toHaveURL(/\/en\/assistant/);
    await expect(page.getByText(/You are offline/i)).toBeVisible();
    await page.getByPlaceholder(/Type your farming question/i).fill('When to irrigate wheat?');
    await page.getByRole('button', { name: /^Ask$/i }).click();
    await expect(page.getByText(/AI advisor needs internet/i)).toBeVisible();

    // Uncached page navigation serves branded offline fallback (/offline.html)
    await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k.includes('-pages-')) await caches.delete(k);
      }
    });
    await page.goto('/en/crop/wheat');
    await expect(page.getByText('انٹرنیٹ دستیاب نہیں')).toBeVisible();
    await expect(page.getByText(/You're offline/i)).toBeVisible();

    await context.setOffline(false);
  });

  test('6. Camera permissions on Scan screen: granted viewfinder and denied fallback guidance', async ({
    page,
    context,
    baseURL,
  }) => {
    await authenticateFarmer(page, context, baseURL!);

    // Granted camera stream test
    await context.grantPermissions(['camera']);
    await page.addInitScript(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const stream = canvas.captureStream(5);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => stream,
        },
      });
    });

    await page.goto('/en/scan');
    await page.getByRole('button', { name: /Take Plant Photo/i }).click();
    await expect(page.locator('video')).toBeVisible();
    await expect(page.getByRole('button', { name: /Capture Photo/i })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Denied camera test
    const deniedPage = await context.newPage();
    await authenticateFarmer(deniedPage, context, baseURL!);
    await deniedPage.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            const err = new Error('Permission denied');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      });
      // Prevent native file dialog from blocking headless Chromium
      HTMLInputElement.prototype.click = () => {};
    });

    await deniedPage.goto('/en/scan');
    await deniedPage.getByRole('button', { name: /Take Plant Photo/i }).click();
    await expect(deniedPage.getByText(/Camera permission was denied/i)).toBeVisible();
    await deniedPage.close();
  });

  test('7. Urdu RTL, English LTR, and Sindhi layouts have zero horizontal overflow on mobile', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // Urdu RTL welcome
    await page.goto('/ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const urOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(urOverflow).toBe(false);

    // English LTR + Authenticated pages
    await authenticateFarmer(page, context, baseURL!);
    for (const path of ['/en/home', '/en/scan', '/en/assistant', '/en/weather', '/en/profile', '/ur/home', '/ur/scan']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(overflow, `No horizontal overflow on ${path}`).toBe(false);
    }

    // Sindhi selector on Scan & Assistant
    await page.goto('/ur/scan');
    await page.getByRole('button', { name: 'سنڌي' }).click();
    await expect(page.getByText('ٻوٽي جي هڪ صاف تصوير ڪڍو')).toBeVisible();

    await page.goto('/ur/assistant');
    await page.getByRole('button', { name: 'سنڌي' }).click();
    await expect(page.getByText(/السلام عليڪم! مان زرخيز آهيان/)).toBeVisible();
  });
});
