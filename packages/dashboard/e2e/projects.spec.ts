import { expect, test } from '@playwright/test'

test('adds a project from a fake gh repo list and shows the no-COO-layout copy', async ({
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
  await expect(page.getByText('widgets')).toBeVisible()
  await expect(page.getByText(/no proposals folder yet/i)).toBeVisible()
})
