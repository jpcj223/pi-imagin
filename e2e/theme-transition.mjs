import assert from "node:assert/strict";

// 从已打开的英文常规设置开始，结束恢复浅色。
export async function checkThemeTransitions(page, { capture = async () => {} } = {}) {
  const general = page.locator('.settings-workspace-page:not(.plugins-workspace-page) .settings-general');
  const select = id => general.locator(`input[name="theme"][value="${id}"]`).evaluate(node => node.click());
  const settled = theme => page.waitForFunction(value => document.documentElement.dataset.theme === value
    && !document.documentElement.dataset.themeTransition, theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await select("light"); await settled("light");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    const root = document.documentElement, original = root.animate;
    window.__themeReveals = [];
    root.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (options?.pseudoElement === "::view-transition-new(root)") {
        window.__themeReveals.push({ frames, options, marker: root.dataset.themeTransition, x: innerWidth / 2, y: innerHeight / 2 });
      }
      return animation;
    };
    window.__restoreThemeAnimate = () => { root.animate = original; };
  });
  await select("dark");
  await page.waitForFunction(() => window.__themeReveals.length > 0);
  const reveal = await page.evaluate(() => window.__themeReveals[0]);
  assert.equal(reveal.frames.clipPath[0], "circle(0% at 50% 50%)");
  assert.equal(reveal.options.duration, 450);
  assert.equal(reveal.marker, "true");
  await capture(page, "settings-theme-reveal");
  await settled("dark");
  await page.evaluate(() => {
    const select = id => document.querySelector(`.settings-general input[name="theme"][value="${id}"]`).click();
    select("mist"); select("rose"); select("light");
  });
  await settled("light");
  assert.equal(await general.locator('input[name="theme"]:checked').inputValue(), "light");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const count = await page.evaluate(() => window.__themeReveals.length);
  await select("dark"); await settled("dark");
  assert.equal(await page.evaluate(() => window.__themeReveals.length), count);
  await select("light"); await settled("light");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { window.__restoreThemeAnimate(); delete window.__restoreThemeAnimate; delete window.__themeReveals; });
  console.log("PASS: 中心扩散、快速切换最终选择、减少动态效果和主题标记清理");
}
