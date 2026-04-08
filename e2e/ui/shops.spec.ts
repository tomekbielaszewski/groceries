import { test, expect } from '../fixtures/grocery'

test.describe('Settings › Shops', () => {
  test.beforeEach(async ({ resetViaApi }) => {
    await resetViaApi()
  })

  test('1 – create a shop: row visible with correct name and color dot', async ({
    seedViaApi, gotoApp, page,
  }) => {
    // No pre-seeded shops — create via UI
    await gotoApp('/settings')

    await page.getByPlaceholder('Shop name…').fill('Tesco')
    // Click the blue color (#3b82f6 is at index 5 in the PALETTE)
    await page.getByLabel('Color #3b82f6').click()
    await page.getByRole('button', { name: 'Add shop' }).click()

    // Row should appear
    await expect(page.getByText('Tesco')).toBeVisible()
    // The ShopDot rendered for this shop should have the chosen blue color
    // (ShopDot renders a div/span with inline background-color)
    const shopRow = page.locator('div').filter({ hasText: 'Tesco' }).first()
    await expect(shopRow).toBeVisible()

    // Color dot is the first element inside the row with background-color set
    const dot = shopRow.locator('[style*="background-color"]').first()
    await expect(dot).toHaveCSS('background-color', 'rgb(59, 130, 246)') // #3b82f6
  })

  test('2 – edit a shop name: new name displayed after save', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const shopId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      shops: [{ id: shopId, name: 'Old Name', color: '#ef4444', version: 1, updatedAt: t }],
    })

    await gotoApp('/settings')

    // The shop should be visible after bootstrap
    await expect(page.getByText('Old Name')).toBeVisible()

    // Click "Edit" next to the shop
    const shopRow = page.locator('div').filter({ hasText: 'Old Name' }).first()
    await shopRow.getByRole('button', { name: 'Edit' }).click()

    // Form switches to edit mode
    const nameInput = page.getByPlaceholder('Shop name…')
    await nameInput.clear()
    await nameInput.fill('New Name')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('New Name')).toBeVisible()
    await expect(page.getByText('Old Name')).not.toBeVisible()
  })

  test('3 – delete a shop: row removed from list', async ({
    seedViaApi, gotoApp, page,
  }) => {
    const shopId = globalThis.crypto.randomUUID()
    const t = new Date().toISOString()
    await seedViaApi({
      shops: [{ id: shopId, name: 'Shop To Delete', color: '#8b5cf6', version: 1, updatedAt: t }],
    })

    await gotoApp('/settings')
    // Use exact span to avoid matching parent containers in strict mode
    const shopNameEl = page.locator('span.flex-1', { hasText: 'Shop To Delete' })
    await expect(shopNameEl).toBeVisible()

    // Navigate up to the flex row and find the delete button within it
    const shopRow = page.locator('div.flex.items-center').filter({
      has: page.locator('span.flex-1', { hasText: 'Shop To Delete' }),
    })
    await shopRow.getByRole('button', { name: 'Delete shop' }).click()

    await expect(shopNameEl).not.toBeVisible()
  })
})
