import { expect, test, type Page } from "@playwright/test";

const lessons = [
  ["Fire, smoke and heat", "Next lesson"],
  ["Stop and evacuate", "Next lesson"],
  ["CO2 extinguisher", "Next lesson"],
  ["Pull, Aim, Squeeze, Sweep", "Next lesson"],
  ["Judgment to stop and evacuate", "Start knowledge check"],
] as const;

const correctQuiz = [
  "When conditions are unsafe or worsening",
  "Pull",
  "The marked target zone",
  "Cross the ordered left and right target zones",
  "Raise the alarm and evacuate",
] as const;

async function openFixture(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/learn/fire-fixture-001/1");
  await expect(page.getByText("DEMO FIXTURE — NOT APPROVED SAFETY PROCEDURE")).toBeVisible();
  await page.getByRole("button", { name: "Download and start" }).click();
  await expect(page.getByRole("heading", { name: /Lesson 1\/5/ })).toBeVisible();
  return pageErrors;
}

async function completeLessons(page: Page) {
  for (const [answer, next] of lessons) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: next, exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Knowledge check 1/5" })).toBeVisible();
}

async function answerQuiz(page: Page, answers: readonly string[]) {
  for (let index = 0; index < answers.length; index += 1) {
    await page.getByRole("button", { name: answers[index]!, exact: true }).click();
    const nextName = index === answers.length - 1 ? "See knowledge result" : "Next question";
    await expect(page.getByRole("button", { name: nextName, exact: true })).toBeVisible();
    await page.getByRole("button", { name: nextName, exact: true }).click();
  }
}

async function completePractical(page: Page) {
  await page.getByRole("button", { name: "Start interactive preview" }).click();
  await page.locator('[data-target="co2"]').waitFor({ state: "attached" });
  await page.locator('[data-target="co2"]').dispatchEvent("click");
  await page.locator('[data-target="pin"]').dispatchEvent("click");
  await page.locator('[data-target="aim_zone"]').dispatchEvent("click");
  const trigger = page.locator('[data-target="trigger"]');
  await trigger.dispatchEvent("mousedown");
  await page.waitForTimeout(650);
  await trigger.dispatchEvent("mouseup");
  await page.locator('[data-target="sweep_left"]').dispatchEvent("click");
  await page.locator('[data-target="sweep_right"]').dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Conditions changed" })).toBeVisible();
}

test.use({ baseURL: "http://127.0.0.1:4173" });

test("fixture completes the flagship journey with a real 4/5 gate", async ({ page }) => {
  const pageErrors = await openFixture(page);
  await completeLessons(page);

  await answerQuiz(page, ["Always continue", ...correctQuiz.slice(1)]);
  await expect(page.getByText("Knowledge check passed")).toBeVisible();
  await expect(page.getByText("4/5 correct is required before the practical.")).toBeVisible();
  await page.getByRole("button", { name: "Continue to practical" }).click();

  await completePractical(page);
  await page.getByRole("button", { name: "Raise alarm and evacuate" }).click();

  await expect(page.getByRole("heading", { name: "Training complete" })).toBeVisible();
  await expect(page.getByText("Knowledge").locator(".." ).getByText("80%")).toBeVisible();
  await expect(page.getByText("Practical").locator(".." ).getByText("100%")).toBeVisible();
  await expect(page.getByText("Judgment").locator(".." ).getByText("100%")).toBeVisible();
  await expect(page.getByText("Critical safety mistakes").locator(".." ).getByText("0")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("3/5 knowledge result blocks the practical and supports retry without resetting lessons", async ({ page }) => {
  const pageErrors = await openFixture(page);
  await completeLessons(page);

  await answerQuiz(page, ["Always continue", "Push", ...correctQuiz.slice(2)]);
  await expect(page.getByText("Knowledge check needs retry")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start interactive preview" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry knowledge check" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge check 1/5" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Lesson/ })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("unsafe scenario choice is recorded and prevents a passing result", async ({ page }) => {
  const pageErrors = await openFixture(page);
  await completeLessons(page);
  await answerQuiz(page, correctQuiz);
  await page.getByRole("button", { name: "Continue to practical" }).click();
  await completePractical(page);

  await page.getByRole("button", { name: "Keep fighting" }).click();
  await expect(page.getByText(/Continuing or moving closer is unsafe/)).toBeVisible();
  await page.getByRole("button", { name: "Raise alarm and evacuate" }).click();
  await expect(page.getByRole("heading", { name: "Needs retry" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
