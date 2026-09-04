import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function expectNoAccessibilityViolations(page: Page, context: string): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
  }));
  expect(violations, `${context} accessibility violations`).toEqual([]);
}

test("meets automated WCAG checks in the empty workspace", async ({ page }) => {
  await page.goto("/?preview=empty");
  await expect(page.getByRole("heading", { name: "Your first trusted task" })).toBeVisible();
  await expectNoAccessibilityViolations(page, "Empty workspace");
});

test("meets automated WCAG checks in the active project workspace", async ({ page }) => {
  await page.goto("/?preview=project");
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Verify", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Understand", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export proof", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Signed JSON", exact: true })).toHaveCount(0);
  await expectNoAccessibilityViolations(page, "Active workspace");

  for (const view of ["Changes", "Terminal", "Browser"]) {
    await page.getByRole("tab", { name: view, exact: true }).click();
    await expect(page.getByRole("tab", { name: view, exact: true })).toHaveAttribute("aria-selected", "true");
    await expectNoAccessibilityViolations(page, `${view} evidence view`);
  }
});

test("meets automated WCAG checks across settings", async ({ page }) => {
  await page.goto("/?preview=project");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await expectNoAccessibilityViolations(page, "Settings");
});
