import { expect, test } from '@playwright/test'

test('adds a project from a fake gh repo list and activates the COO adapter', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()

  await page.getByRole('button', { name: /add from github/i }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByText('octo/widgets').click()
  await page.getByRole('button', { name: /add project/i }).click()

  await expect(page.getByRole('alertdialog')).not.toBeVisible()
  const row = page.getByRole('row', { name: /widgets/ })
  await expect(row.getByRole('cell', { name: 'widgets' })).toBeVisible()
  // The fake gh remote is a local bare repo: no PR host, so the layout is
  // committed directly and the adapter is live at once.
  await expect(row.getByText('COO missions')).toBeVisible()
})
