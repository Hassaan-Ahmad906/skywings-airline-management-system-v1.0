const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium } = require('playwright');
async function main() {
  const app = express(); app.use(express.static(path.join(__dirname, '../frontend')));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      user: { role: 'user', userId: 1, first_name: 'Ali', last_name: 'Khan' }, airports: [], flights: []
    } }) }));
    await page.goto(`http://127.0.0.1:${server.address().port}/flight-search.html`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Toggle navigation' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button', { name: 'Toggle navigation' }).getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Enter');
    const chip = page.getByRole('button', { name: /Tomorrow/ });
    await chip.focus(); await page.keyboard.press('Enter');
    assert.ok(await page.locator('#searchDepDate').inputValue());
    await page.evaluate(() => showBookingModal(1, 100, 'economy', 1));
    const dialog = page.getByRole('dialog'); await dialog.waitFor();
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
    await dialog.locator('button[type="submit"]').focus(); await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)));
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await chip.evaluate(element => element === document.activeElement), true);
    assert.deepEqual(errors, []);
    console.log('Browser keyboard checks passed: mobile navigation, quick dates, modal focus trap, Escape, focus restoration.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
