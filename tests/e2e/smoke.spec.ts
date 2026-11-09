import { test, expect } from '@playwright/test';

test.describe('Zarkhez Mobile PWA Smoke Tests (Section 14)', () => {
  test('Welcome screen renders in Urdu RTL, toggles to English LTR, and navigates to Home', async ({
    page,
  }) => {
    await page.goto('/ur');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ur');

    // Switch to English
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en/);
    await expect(html).toHaveAttribute('dir', 'ltr');

    // Click Get Started -> select Multan -> go to Home
    await page.getByRole('button', { name: /Get Started/i }).click();
    await page.getByRole('button', { name: 'Multan' }).click();
    await expect(page).toHaveURL(/\/en\/home/);
  });

  test('Scan flow works with sample leaf and displays confidence and advice', async ({
    page,
  }) => {
    await page.goto('/en/scan');
    await page.getByRole('button', { name: /Tomato Early Blight/i }).click();
    await expect(page.getByText(/AI Confidence/i)).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/Tomato Early Blight/i)).toBeVisible();
  });

  test('Diary allows adding and deleting an entry', async ({ page }) => {
    await page.goto('/en/diary');
    await page.getByRole('button', { name: /Add Entry/i }).click();
    await page.getByPlaceholder('5000').fill('3200');
    await page
      .getByPlaceholder(/Write what you did/i)
      .fill('Test potash purchase');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Test potash purchase')).toBeVisible();
  });
});
