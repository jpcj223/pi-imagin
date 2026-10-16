import assert from "node:assert/strict";

/** The fixture has one ordinary fence and one Mermaid diagram. */
export async function checkCodeBackground(page) {
  // 默认主题为浅色；验证系统主题切换时显式选择跟随系统，并在结束后还原偏好。
  const previousTheme = await page.evaluate(() => {
    const previous = localStorage.getItem("pi-theme");
    localStorage.setItem("pi-theme", "auto");
    return previous;
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const warnings = [];
  const onConsole = (message) => {
    if (/conflicting property|style property during rerender/.test(message.text())) {
      warnings.push(message.text());
    }
  };
  page.on("console", onConsole);
  const source = page.getByRole("button", { name: "Source", exact: true });
  await source.click();
  const blocks = page.locator(".markdown-code-block pre");
  await blocks.nth(1).waitFor();
  try {
    for (const colorScheme of ["light", "dark", "light", "dark", "light"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, colorScheme);
      await page.waitForFunction(() => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "color-mix(in srgb, var(--bg) 92%, var(--bg-panel))";
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const nodes = [...document.querySelectorAll(".markdown-code-block pre")];
        return nodes.length === 2 && nodes.every((node) => (
          getComputedStyle(node).backgroundColor === expected
          && getComputedStyle(node).borderTopWidth === "0px"
          && getComputedStyle(node.querySelector("code")).backgroundColor === "rgba(0, 0, 0, 0)"
        ));
      });
    }
    assert.deepEqual(warnings, [], "Theme switches must not mix background shorthand and backgroundColor");
  } finally {
    page.off("console", onConsole);
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(previous => {
      if (previous === null) localStorage.removeItem("pi-theme");
      else localStorage.setItem("pi-theme", previous);
    }, previousTheme);
  }
  console.log("PASS: code and Mermaid source backgrounds survive repeated theme switches");
}
