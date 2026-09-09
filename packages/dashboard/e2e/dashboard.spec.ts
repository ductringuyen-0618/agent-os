import { expect, test } from '@playwright/test'

const PANELS = [
  'Overview',
  'Runs',
  'Decisions',
  'Wiki',
  'Skills',
  'Routines',
  'Costs',
]

test('dashboard renders every panel and approves a seeded decision', async ({
  page,
}) => {
  await page.goto('/')
  // The very first click after load must switch panels (regression guard).
  await page.getByRole('button', { name: 'Runs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()

  for (const panel of PANELS) {
    await page.getByRole('button', { name: panel, exact: true }).click()
    await expect(page.getByRole('heading', { name: panel })).toBeVisible()
  }

  // Number keys work as shortcuts.
  await page.keyboard.press('1')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByText('Waiting on you').first()).toBeVisible()

  await page.getByRole('button', { name: 'Decisions', exact: true }).click()
  await expect(
    page.getByText('Approve techpulse proposal 001-add-digest').first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm approval' }).click()
  await expect(page.getByText('Nothing waiting on you')).toBeVisible()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(
    page.getByText('Approve techpulse proposal 001-add-digest').first(),
  ).toBeVisible()
})

test('requests panel shows a seeded workflow and its live stepper', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Requests', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Requests' })).toBeVisible()
  await page
    .getByRole('button', { name: 'Add a personalized company digest' })
    .click()
  await expect(page.getByText('build').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Terminate' })).toBeVisible()
})
