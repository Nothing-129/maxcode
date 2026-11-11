import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"

// Run from ego-browser nodejs against a real, connected conversation that has
// received a model-generated suggestion. This never sends the adopted prompt.
// In ego-browser nodejs, import this file by its absolute path, then call
// verifyComposerSuggestion(task.page("p1"), "/tmp/maxcode-composer-e2e").
// The page must use Simplified Chinese, the default 16px root font and an empty
// compact conversation composer. The caller owns TaskSpace finish/cleanup.
export async function verifyComposerSuggestion(page, evidenceDir) {
  await mkdir(evidenceDir, { recursive: true })
  const offer = 'button[aria-label="采纳建议"]'
  await page.waitForSelector(offer, { state: "visible", timeout: 60000 })
  const root = '[data-layout-e2e="true"]'
  const editor = `${root} [contenteditable="true"]`
  const read = () =>
    page.evaluate(() => {
      const box = document.querySelector('[data-layout-e2e="true"]')
      const actions = box.querySelector(".maxcode-composer-actions")
      const toolbar = actions.parentElement
      const add = toolbar.querySelector("button")
      const r = box.getBoundingClientRect()
      return {
        boxHeight: r.height,
        toolbarHeight: toolbar.getBoundingClientRect().height,
        actionsHeight: actions.getBoundingClientRect().height,
        addBottomGap: r.bottom - add.getBoundingClientRect().bottom,
        text: box.querySelector("[contenteditable]").textContent,
        suggestionVisible: !!box.querySelector('button[aria-label="采纳建议"]'),
      }
    })
  const results = []
  for (const width of [1280, 390]) {
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: width < 500,
    })
    await page.waitForFunction((w) => innerWidth === w, width)
    await page.waitForSelector(offer, { state: "visible" })
    await page.evaluate(() => {
      document
        .querySelector('button[aria-label="采纳建议"]')
        .closest(".codeg-composer-chrome")
        .setAttribute("data-layout-e2e", "true")
    })
    await page.waitForSelector(`${root} ${offer}`, { state: "visible" })
    const before = await read()
    assert.equal(before.text, "")
    assert.equal(before.boxHeight, 104)
    assert.equal(before.toolbarHeight, 36)
    assert.equal(before.actionsHeight, 32)
    assert.equal(before.addBottomGap, 9)
    await page.screenshot({ path: `${evidenceDir}/${width}-suggestion.png` })
    if (width < 500) {
      await page.click(`${root} ${offer}`)
    } else {
      await page.click(editor)
      await page.press(editor, "Tab")
    }
    await page.waitForSelector(`${root} ${offer}`, { state: "hidden" })
    const adopted = await read()
    assert.ok(adopted.text.trim(), "adoption must fill the actual editor")
    assert.equal(adopted.suggestionVisible, false)
    for (const key of [
      "boxHeight",
      "toolbarHeight",
      "actionsHeight",
      "addBottomGap",
    ]) {
      assert.equal(
        adopted[key],
        before[key],
        `${width}: adoption changed ${key}`
      )
    }
    await page.screenshot({ path: `${evidenceDir}/${width}-adopted.png` })
    await page.click(editor)
    await page.press(editor, "ControlOrMeta+A")
    await page.press(editor, "Backspace")
    await page.waitForSelector(`${root} ${offer}`, { state: "visible" })
    const cleared = await read()
    assert.deepEqual(
      cleared,
      before,
      `${width}: clearing must restore the offer without moving controls`
    )
    results.push({ width, before, adopted, cleared })
  }
  await writeFile(
    `${evidenceDir}/measurements.json`,
    JSON.stringify(results, null, 2)
  )
  return results
}
