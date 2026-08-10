import { expect, test } from "@playwright/test";

test("renders the spotlight shell with title and input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SpotAI", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator("textarea").first(),
  ).toBeVisible();
});

test("light theme applies through the Settings modal and persists", async ({ page }) => {
  await page.goto("/");
  // The window starts on the saved/default theme (dark).
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTitle("Settings (Ctrl+,)").click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  // Live preview without saving.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Close via Escape without saving: the preview must revert to the saved theme.
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("slash palette lists system actions and capture button is present", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").first().fill("/");
  // The system actions (new chat, theme, capture, settings…) show in the palette.
  await expect(page.getByText("New chat", { exact: true })).toBeVisible();
  await expect(page.getByText("Capture screen region", { exact: true })).toBeVisible();
  // The dedicated capture toolbar button exists.
  await expect(page.getByTitle("Capture screen region").last()).toBeVisible();
});

test("typing /theme + Enter directly toggles the theme without browsing the palette", async ({ page }) => {
  await page.goto("/");
  const textarea = page.locator("textarea").first();
  const initial = await page.locator("html").getAttribute("data-theme");

  // Type the exact keyword and press Enter — the command runs immediately.
  await textarea.fill("/theme");
  await page.keyboard.press("Enter");

  // Playwright's expect auto-retries, so this assertion waits up to 5s for
  // the React state update to propagate and flips the theme attribute.
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", initial);
  // The prompt is cleared so the palette closes.
  await expect(textarea).toHaveValue("");
});

test("typing /new + Enter starts a new chat and clears the prompt", async ({ page }) => {
  await page.goto("/");
  const textarea = page.locator("textarea").first();

  await textarea.fill("/new");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);

  await expect(textarea).toHaveValue("");
});

test("partial slash query like /cap still opens the fuzzy palette", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").first().fill("/cap");
  // toBeVisible auto-retries, no need for an explicit wait — existing palette
  // tests do the same.
  await expect(page.getByText("Capture screen region", { exact: true })).toBeVisible();
});

test("input is ready; send stays disabled until a model is available", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("textarea").first()).toBeVisible();
  // Without a running local engine or a cloud API key there is no model yet,
  // so the send button must stay disabled even with a typed prompt.
  await page.locator("textarea").first().fill("hello");
  await expect(page.getByTitle("Send prompt")).toBeDisabled();
});
