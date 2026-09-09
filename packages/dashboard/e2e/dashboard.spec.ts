import { expect, test } from '@playwright/test'

const PANELS = [
  'Agents',
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
  for (const panel of PANELS) {
    await page.getByRole('button', { name: panel, exact: true }).click()
    await expect(page.getByRole('heading', { name: panel })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Decisions', exact: true }).click()
  await expect(
    page.getByText('Approve techpulse proposal 001-add-digest'),
  ).toBeVisible()
  await page.getByRole('button', { name: /approve/i }).click()
  await page.getByRole('button', { name: 'History' }).click()
  await expect(
    page.getByText('Approve techpulse proposal 001-add-digest'),
  ).toBeVisible()
})
