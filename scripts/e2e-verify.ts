import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";

const PORT = 3099;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SHOTS_DIR = path.join(process.cwd(), ".e2e-artifacts");

function evalDisplayEq(text: string): number {
  const clean = text
    .replace(/−/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .trim();
  const m = clean.match(/^(-?\d+)\s*([+\-*/])\s*(-?\d+)$/);
  if (!m) throw new Error(`Could not parse equation: "${text}"`);
  const a = Number(m[1]);
  const b = Number(m[3]);
  switch (m[2]) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    default:
      throw new Error(`Unknown operator: ${m[2]}`);
  }
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dims.scrollWidth <= dims.clientWidth,
    `Horizontal overflow on ${label}: scrollWidth=${dims.scrollWidth} > clientWidth=${dims.clientWidth}`,
  );
}

async function waitForHealth(url: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Standalone server did not become healthy in time");
}

async function main() {
  const standaloneServerJs = path.join(
    process.cwd(),
    ".next",
    "standalone",
    "server.js",
  );
  await fs.access(standaloneServerJs);

  // Copy public and .next/static into .next/standalone just like Dockerfile runner stage
  await fs.cp(
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), ".next", "standalone", "public"),
    { recursive: true },
  );
  await fs.cp(
    path.join(process.cwd(), ".next", "static"),
    path.join(process.cwd(), ".next", "standalone", ".next", "static"),
    { recursive: true },
  );

  await fs.mkdir(SHOTS_DIR, { recursive: true });
  const tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "deskmath-e2e-"));

  const serverProc = spawn("node", [standaloneServerJs], {
    cwd: path.join(process.cwd(), ".next", "standalone"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      STORAGE_BACKEND: "local",
      LOCAL_DATA_DIR: tmpDataDir,
      AUTH_REQUIRED: "false",
      ALLOW_LOCAL_AI_FALLBACK: "true",
    },
    stdio: "pipe",
  });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const server5xx: string[] = [];

  try {
    await waitForHealth(BASE_URL);

    // Smoke-check operational endpoints
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    assert.equal(healthRes.status, 200);
    const authCfgRes = await fetch(`${BASE_URL}/api/auth/config`);
    assert.equal(authCfgRes.status, 200);

    const browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    try {
      // =====================================================================
      // 1. iPhone Chrome Viewport (390x844, isMobile: true, hasTouch: true)
      // =====================================================================
      console.log("==> Verifying iPhone Chrome viewport (390x844)...");
      const iphoneCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/134.0.6998.33 Mobile/15E148 Safari/604.1",
      });
      const iphonePage = await iphoneCtx.newPage();
      iphonePage.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(`[iPhone] ${m.text()}`);
      });
      iphonePage.on("pageerror", (e) =>
        pageErrors.push(`[iPhone] ${e.message}`),
      );
      iphonePage.on("response", (r) => {
        if (r.status() >= 500) server5xx.push(`[iPhone] ${r.status()} ${r.url()}`);
      });

      await iphonePage.goto(BASE_URL, { waitUntil: "networkidle" });
      await iphonePage
        .getByRole("heading", { name: "DeskMath Quant Studio" })
        .waitFor();
      await assertNoHorizontalOverflow(iphonePage, "iPhone Train Setup");

      // Verify bottom fixed 4-column nav bar & aria-current="page"
      const iphoneNavPos = await iphonePage
        .locator("nav.app-nav")
        .evaluate((el) => getComputedStyle(el).position);
      assert.equal(iphoneNavPos, "fixed");
      assert.equal(
        await iphonePage
          .locator('nav.app-nav button[aria-current="page"]')
          .innerText(),
        "Train",
      );
      await iphonePage.screenshot({
        path: path.join(SHOTS_DIR, "iphone_01_setup.png"),
        fullPage: true,
      });

      // Enable negative subtraction to verify iPhone ± sign button, then run drill
      await iphonePage
        .getByLabel(/Allow negative subtraction results/i)
        .check();
      await iphonePage.getByRole("button", { name: "Start Drill" }).tap();
      await iphonePage.locator(".equation-display").waitFor();
      await iphonePage
        .getByRole("button", { name: "Toggle negative sign" })
        .waitFor();
      await assertNoHorizontalOverflow(iphonePage, "iPhone Active Drill");

      for (let i = 0; i < 3; i += 1) {
        const eqText = await iphonePage.locator(".equation-display").innerText();
        const ans = evalDisplayEq(eqText);
        const val = i === 2 ? ans + 100 : ans; // 3rd is intentional carry slip
        await iphonePage.locator("#drill-answer-input").fill(String(val));
        await iphonePage.locator("#drill-answer-input").press("Enter");
      }
      await iphonePage.screenshot({
        path: path.join(SHOTS_DIR, "iphone_02_drill.png"),
        fullPage: true,
      });

      await iphonePage.getByRole("button", { name: /End Drill/i }).tap();
      await iphonePage
        .getByRole("heading", { name: "Session Debrief" })
        .waitFor();
      await assertNoHorizontalOverflow(iphonePage, "iPhone Session Debrief");

      // Navigate via bottom tab bar to Mistakes
      await iphonePage.locator("nav.app-nav").getByText("Mistakes").tap();
      await iphonePage
        .getByRole("heading", { name: "Mistake & Slow-Solve Review" })
        .waitFor();
      await assertNoHorizontalOverflow(iphonePage, "iPhone Mistakes");
      await iphonePage.screenshot({
        path: path.join(SHOTS_DIR, "iphone_03_mistakes.png"),
        fullPage: true,
      });

      // Navigate to Coach via bottom tab bar
      await iphonePage.locator("nav.app-nav").getByText("Coach").tap();
      await iphonePage
        .getByRole("heading", { name: "Quant Mental Math Coach" })
        .waitFor();
      await assertNoHorizontalOverflow(iphonePage, "iPhone Coach");
      await iphonePage.screenshot({
        path: path.join(SHOTS_DIR, "iphone_04_coach.png"),
        fullPage: true,
      });
      await iphoneCtx.close();

      // =====================================================================
      // 2. PC Chrome Viewport (1280x800, hasTouch: false)
      // =====================================================================
      console.log("==> Verifying PC Chrome viewport (1280x800)...");
      const pcCtx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
      });
      const pcPage = await pcCtx.newPage();
      pcPage.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(`[PC] ${m.text()}`);
      });
      pcPage.on("pageerror", (e) => pageErrors.push(`[PC] ${e.message}`));
      pcPage.on("response", (r) => {
        if (r.status() >= 500) server5xx.push(`[PC] ${r.status()} ${r.url()}`);
      });

      await pcPage.goto(BASE_URL, { waitUntil: "networkidle" });
      await pcPage
        .getByRole("heading", { name: "DeskMath Quant Studio" })
        .waitFor();
      await assertNoHorizontalOverflow(pcPage, "PC Train Setup");

      // Verify sticky left rail on PC
      const pcNavPos = await pcPage
        .locator("nav.app-nav")
        .evaluate((el) => getComputedStyle(el).position);
      assert.equal(pcNavPos, "sticky");

      // Open CustomRangeModal (<dialog>), test :user-invalid timing + Esc dismissal
      await pcPage
        .getByRole("button", { name: /Customize Operand Ranges/i })
        .click();
      await pcPage
        .getByRole("heading", { name: "Customize Operand Ranges & Timer" })
        .waitFor();

      // Initially error message must be hidden before interaction
      const qCountErrVisibleBefore = await pcPage
        .locator("#rng-qcount-err")
        .isVisible();
      assert.equal(qCountErrVisibleBefore, false);

      // Enter out-of-range value "2" (< 5) and blur -> :user-invalid reveals error
      await pcPage.locator("#rng-qcount").fill("2");
      await pcPage.locator("#add-min-a").focus();
      const qCountErrVisibleAfter = await pcPage
        .locator("#rng-qcount-err")
        .isVisible();
      assert.equal(qCountErrVisibleAfter, true);
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_01_dialog_validation.png"),
      });

      // Fix value -> error clears immediately
      await pcPage.locator("#rng-qcount").fill("25");
      assert.equal(await pcPage.locator("#rng-qcount-err").isVisible(), false);

      // Dismiss dialog with Escape key
      await pcPage.keyboard.press("Escape");
      await pcPage.waitForFunction(() =>
        Array.from(document.querySelectorAll("dialog")).every(
          (d) => !d.open && d.getAnimations({ subtree: true }).length === 0,
        ),
      );

      // Open Settings dialog, toggle Dark Mode, and test backdrop light-dismiss
      await pcPage.getByRole("button", { name: "Settings" }).click();
      await pcPage
        .getByRole("heading", { name: "DeskMath Settings & Google Cloud AI" })
        .waitFor();
      await pcPage.getByLabel("Dark").check();
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_02_settings_dark.png"),
      });

      // Click outside dialog rect (top-left corner x=10, y=10) to verify light-dismiss!
      await pcPage.mouse.click(10, 10);
      await pcPage.waitForFunction(() =>
        Array.from(document.querySelectorAll("dialog")).every(
          (d) => !d.open && d.getAnimations({ subtree: true }).length === 0,
        ),
      );
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_03_setup_dark.png"),
        fullPage: true,
      });

      // Test Voice: Audio + Keys mode + Peek
      await pcPage.getByLabel("Voice: Audio + Keys").check();
      await pcPage.getByRole("button", { name: "Start Drill" }).click();
      await pcPage.getByText(/Blind Audio Active/i).waitFor();
      await pcPage.getByRole("button", { name: /Peek/i }).click();
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_04_voice_drill.png"),
        fullPage: true,
      });
      await pcPage.getByRole("button", { name: /End Drill/i }).click();

      // Two-column PC Mistakes Workbench
      await pcPage.locator("nav.app-nav").getByText("Mistakes").click();
      await pcPage
        .getByRole("heading", { name: "Mistake & Slow-Solve Review" })
        .waitFor();
      await pcPage.getByRole("button", { name: "Speed", exact: true }).click();
      await assertNoHorizontalOverflow(pcPage, "PC Mistakes Workbench");
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_05_mistakes_workbench.png"),
        fullPage: true,
      });

      // Two-column PC Coach Workbench
      await pcPage.locator("nav.app-nav").getByText("Coach").click();
      await pcPage.locator("#coach-question-input").fill("How do I calculate 56*23 faster?");
      await pcPage.getByRole("button", { name: "Ask Suggestion" }).click();
      await pcPage.getByText(/Distributive Left-to-Right Split/i).waitFor();
      await assertNoHorizontalOverflow(pcPage, "PC Coach Workbench");
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_06_coach_workbench.png"),
        fullPage: true,
      });

      // PC Analytics Workbench
      await pcPage.locator("nav.app-nav").getByText("Analytics").click();
      await pcPage
        .getByRole("heading", { name: "Speed & Accuracy by Operation" })
        .waitFor();
      await assertNoHorizontalOverflow(pcPage, "PC Analytics");
      await pcPage.screenshot({
        path: path.join(SHOTS_DIR, "pc_07_analytics.png"),
        fullPage: true,
      });

      await pcCtx.close();
    } finally {
      await browser.close();
    }

    assert.equal(
      consoleErrors.length,
      0,
      `Console errors: ${consoleErrors.join("; ")}`,
    );
    assert.equal(pageErrors.length, 0, `Page errors: ${pageErrors.join("; ")}`);
    assert.equal(server5xx.length, 0, `Server 5xx: ${server5xx.join("; ")}`);

    console.log(
      "DUAL-VIEWPORT E2E PASSED (iPhone 390x844 + PC 1280x800): 0 horizontal overflow, 0 console/page/5xx errors!",
    );
  } finally {
    serverProc.kill("SIGTERM");
    await fs.rm(tmpDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
