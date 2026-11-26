import { expect, test, type Page } from '@playwright/test'

const project = 'veqxdujksldpctydomxl'
const userId = '11111111-1111-4111-8111-111111111111'
const lotId = '22222222-2222-4222-8222-222222222222'
function jwt() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`
}
async function backend(page: Page, role: 'owner' | 'visitor') {
  let published = role === 'visitor'
  let name = 'Library parking'
  const notifications: Array<() => void> = []
  const slots = Array.from({ length: 10 }, (_, i) => ({
    id: `slot-${i}`, lot_id: lotId, label: `${i < 5 ? 'A' : 'B'}${i % 5 + 1}`,
    row_index: Math.floor(i / 5), position: i % 5 + 1,
    occupancy: i === 1 ? 'occupied' : i < 5 ? 'free' : 'unknown',
    input_mode: 'manual', input_source: 'manual_demo',
    observed_at: i < 5 ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }))
  await page.route(`https://${project}.supabase.co/**`, async (route) => {
    const url = new URL(route.request().url())
    let body: unknown = {}
    if (url.pathname.includes('/profiles')) body = { id: userId, role }
    else if (url.pathname.endsWith('/parking_snapshot')) body = {
      lots: [{ id: lotId, owner_id: userId, name, address: 'Main entrance, Market Road', description: 'A quieter start to your day.', rows: 2, spaces_per_row: 5, published, created_at: new Date().toISOString() }],
      slots,
    }
    else if (url.pathname.endsWith('/publish_parking_lot')) published = route.request().postDataJSON().p_published
    else if (url.pathname.endsWith('/set_manual_occupancy')) {
      const { p_id, p_occupancy } = route.request().postDataJSON()
      const slot = slots.find((s) => s.id === p_id)!
      slot.occupancy = p_occupancy
    }
    else if (url.pathname.endsWith('/update_parking_lot')) name = route.request().postDataJSON().p_name
    else if (url.pathname.endsWith('/mark_all_manual_free')) {
      expect(route.request().postDataJSON()).toEqual({ p_lot_id: lotId })
      slots.forEach((slot) => { if (slot.input_mode === 'manual') slot.occupancy = 'free' })
      body = slots.length
    }
    else if (url.pathname.endsWith('/user')) body = { id: userId, role: 'authenticated', email: 'test@example.test', app_metadata: {}, user_metadata: { role } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.routeWebSocket(`wss://${project}.supabase.co/**`, (socket) => {
    socket.onMessage((raw) => {
      const decoded = JSON.parse(String(raw))
      const data = Array.isArray(decoded)
        ? { join_ref: decoded[0], ref: decoded[1], topic: decoded[2], event: decoded[3], payload: decoded[4] }
        : decoded
      const reply = (payload: object) => socket.send(JSON.stringify(Array.isArray(decoded)
        ? [data.join_ref, data.ref, data.topic, 'phx_reply', payload]
        : { topic: data.topic, event: 'phx_reply', ref: data.ref, payload }))
      if (data.event === 'phx_join') reply({
        status: 'ok', response: { postgres_changes: [{ id: 1, event: 'UPDATE', schema: 'public', table: 'parking_revision' }] },
      })
      if (data.event === 'phx_join') notifications.push(() => {
        const payload = {
          ids: [1], data: {
            schema: 'public', table: 'parking_revision', type: 'UPDATE',
            columns: [{ name: 'id', type: 'int4' }, { name: 'revision', type: 'int8' }],
            record: { id: 1, revision: 2 }, old_record: { id: 1, revision: 1 },
            commit_timestamp: new Date().toISOString(), errors: [],
          },
        }
        socket.send(JSON.stringify(Array.isArray(decoded)
          ? [data.join_ref, null, data.topic, 'postgres_changes', payload]
          : { topic: data.topic, event: 'postgres_changes', ref: null, payload }))
      })
      if (data.event === 'heartbeat' || data.event === 'phx_leave') reply({ status: 'ok', response: {} })
    })
  })
  await page.addInitScript(({ token, id, project, role }) => {
    localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({
      access_token: token, refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600, token_type: 'bearer',
      user: { id, email: 'test@example.test', app_metadata: {}, user_metadata: { role }, aud: 'authenticated', created_at: new Date().toISOString() },
    }))
  }, { token: jwt(), id: userId, project, role })
  return {
    markRemote: () => { slots[0].occupancy = 'occupied'; notifications.forEach((notify) => notify()) },
    unpublishRemote: () => { published = false; notifications.forEach((notify) => notify()) },
  }
}

test('owner sees a restored session, publishes and marks a space', async ({ page }, testInfo) => {
  await backend(page, 'owner')
  await page.goto('/')
  await expect(page.getByText('Live updates connected')).toBeVisible()
  await page.getByRole('button', { name: /Library parking/ }).click()
  await page.getByRole('button', { name: 'Publish lot' }).click()
  await expect(page.getByRole('button', { name: 'Unpublish lot' })).toBeVisible()
  await page.getByRole('button', { name: 'A1: free' }).click()
  await page.getByRole('button', { name: 'Mark occupied' }).click()
  await expect(page.getByRole('button', { name: 'A1: occupied' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Library parking/ }).click()
  await expect(page.getByRole('button', { name: 'A1: occupied' })).toBeVisible()
  await expect(page.getByText('Manual demo mode.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('owner-test-data.png'), fullPage: true })
})

test('visitor cannot edit and Pay & Park collects nothing', async ({ page }, testInfo) => {
  await backend(page, 'visitor')
  await page.goto('/')
  await page.getByRole('button', { name: /Library parking/ }).click()
  await expect(page.getByLabel('A1: free', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Publish lot|Unpublish lot|Edit details|A1: free|Mark all free/ })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: /Pay & Park/ }).click()
  await expect(page.getByText('No payments or reservations are available.', { exact: false })).toBeVisible()
  await expect(page.locator('input')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('pay-and-park-test-data.png'), fullPage: true })
})

test('slot popup stays beside the space when possible and inside the viewport', async ({ page }, testInfo) => {
  await backend(page, 'owner')
  await page.goto('/')
  await expect(page.getByText('Live updates connected')).toBeVisible()
  await page.getByRole('button', { name: /Library parking/ }).click()
  const first = page.getByRole('button', { name: 'A1: free' })
  await first.click()
  const popup = page.getByRole('dialog', { name: 'Update A1' })
  await expect(popup).toBeVisible()
  const target = (await first.boundingBox())!
  const bounds = (await popup.boundingBox())!
  const viewport = page.viewportSize()!
  expect(bounds.x).toBeGreaterThanOrEqual(12)
  expect(bounds.y).toBeGreaterThanOrEqual(12)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 12)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 12)
  if (target.x + target.width + 10 + bounds.width <= viewport.width - 12) {
    expect(bounds.x).toBeCloseTo(target.x + target.width + 10, 0)
  }
  await page.screenshot({ path: testInfo.outputPath('slot-popup-test-data.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(first).toBeFocused()
  const edge = page.getByRole('button', { name: 'A5: free' })
  await edge.click()
  const edgePopup = page.getByRole('dialog', { name: 'Update A5' })
  const edgeBounds = (await edgePopup.boundingBox())!
  const edgeTarget = (await edge.boundingBox())!
  expect(edgeBounds.x).toBeGreaterThanOrEqual(12)
  expect(edgeBounds.x + edgeBounds.width).toBeLessThanOrEqual(viewport.width - 12)
  if (edgeTarget.x + edgeTarget.width + 10 + edgeBounds.width > viewport.width - 12 && edgeTarget.x - edgeBounds.width - 10 >= 12) {
    expect(edgeBounds.x + edgeBounds.width).toBeCloseTo(edgeTarget.x - 10, 0)
  }
  await edgePopup.getByRole('button', { name: 'Mark occupied' }).click()
  await expect(edgePopup).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'A5: occupied' })).toBeVisible()
  await first.click()
  await page.getByRole('heading', { name: 'Parking layout' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('visitor receives SDK realtime notifications without pressing refresh', async ({ page }) => {
  const remote = await backend(page, 'visitor')
  await page.goto('/')
  await expect(page.getByText('Live updates connected')).toBeVisible()
  await page.getByRole('button', { name: /Library parking/ }).click()
  remote.markRemote()
  await expect(page.getByLabel('A1: occupied', { exact: true })).toBeVisible()
  remote.unpublishRemote()
  // The mocked HTTP snapshot intentionally still includes an unpublished lot:
  // the UI must also enforce its published-only boundary.
  await expect(page.getByText('No published lots just yet.')).toBeVisible()
})

test('owner confirms bulk-free and the result survives reload', async ({ page }) => {
  await backend(page, 'owner')
  await page.goto('/')
  await page.getByRole('button', { name: /Library parking/ }).click()
  const request = page.waitForRequest((request) => request.url().endsWith('/mark_all_manual_free'))
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('all 10 manual-input spaces')
    await dialog.accept()
  })
  await page.getByRole('button', { name: 'Mark all free' }).click()
  await request
  await expect(page.getByRole('button', { name: 'B5: free' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /Library parking/ }).click()
  await expect(page.getByRole('button', { name: /: free$/ })).toHaveCount(10)
})

test('unauthenticated page is responsive and labels the illustration', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Khali Spot | Parking, simplified')
  await expect(page.locator('body')).not.toContainText(/campus|college/i)
  await expect(page.getByRole('heading', { name: 'Your spot is waiting.' })).toBeVisible()
  await expect(page.getByText('Manual demo', { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true })
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Find your place.' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toHaveAttribute('placeholder', 'you@example.com')
  await expect(page.getByRole('radio', { name: /Lot owner/ })).toBeVisible()
})
