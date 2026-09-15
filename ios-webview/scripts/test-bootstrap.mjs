import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { runInNewContext } from "node:vm"
import { fileURLToPath } from "node:url"

const fixture = JSON.parse(
  execFileSync(
    fileURLToPath(new URL("../.build/core-tests", import.meta.url)),
    ["--bootstrap-fixture"],
    { encoding: "utf8" }
  )
)

for (const [origin, isTop, expectedWrites] of [
  ["https://example.com", true, 1],
  ["https://example.com", false, 0],
  ["https://example.com.evil.test", true, 0],
  ["http://example.com", true, 0],
  ["https://example.com:444", true, 0],
]) {
  const writes = []
  const window = { location: { origin } }
  window.top = isTop ? window : {}
  runInNewContext(fixture.script, {
    window,
    localStorage: { setItem: (...args) => writes.push(args) },
  })
  assert.equal(writes.length, expectedWrites)
  if (expectedWrites)
    assert.deepEqual(writes[0], ["codeg_token", fixture.token])
  assert.equal(window.pwned, undefined)
}

const styles = []
const navigations = []
const popups = []
const window = {
  location: { assign: (url) => navigations.push(url) },
  open: (...args) => popups.push(args),
}
runInNewContext(fixture.layout, {
  window,
  document: {
    createElement: () => ({}),
    head: { appendChild: (style) => styles.push(style) },
  },
})
assert.equal(styles[0].id, "maxcode-ios-safe-area")
const deferredPopup = window.open("")
deferredPopup.location.href = "https://example.com/settings"
assert.deepEqual(navigations, ["https://example.com/settings"])
window.open("https://other.example", "_blank")
assert.deepEqual(popups[0], ["https://other.example", "_blank", undefined])
const events = []
runInNewContext(fixture.wake, {
  Event: class {
    constructor(type) {
      this.type = type
    }
  },
  window: { dispatchEvent: (event) => events.push(event.type) },
  document: { dispatchEvent: (event) => events.push(event.type) },
})
assert.deepEqual(events, ["online", "visibilitychange"])
console.log(
  "Passed bootstrap origin isolation, token escaping, popup and wake tests"
)

// Enforce the actual Swift-generated policy before and after SPA head updates.
let changed
const metas = []
const document = {
  head: null,
  querySelectorAll: () => metas,
  createElement: () => ({}),
}
runInNewContext(fixture.viewport, {
  document,
  MutationObserver: class {
    constructor(callback) {
      changed = callback
    }
    observe() {}
  },
})
assert.equal(metas.length, 0)
document.head = { appendChild: (meta) => metas.push(meta) }
changed()
assert.equal(metas.length, 1)
assert.match(
  metas[0].content,
  /initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no/
)
assert.match(metas[0].content, /viewport-fit=contain/)
const fixedViewport = metas[0].content
metas[0].content = "width=device-width, initial-scale=2"
metas.push({ name: "viewport", content: "user-scalable=yes" })
changed()
assert.ok(metas.every((meta) => meta.content === fixedViewport))
changed()
assert.equal(metas.length, 2)
console.log("Passed fixed viewport creation and SPA replacement tests")
