import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode contract: Android local file attachments", () => {
  it("delivers ClipData selections to the WebView instead of cancellation", () => {
    const root = "android-webview/app/src/"
    const activity = source(`${root}main/java/app/codeg/web/MainActivity.java`)
    const parser = source(
      `${root}main/java/app/codeg/web/FileChooserResult.java`
    )
    expect(activity).toContain("FileChooserResult.parse(resultCode, data)")
    expect(activity).toContain("callback.onReceiveValue(result)")
    expect(parser).toContain("data.getClipData()")
    expect(parser).toContain("clip.getItemAt(i).getUri()")
    expect(parser).toContain("data.getData()")
    expect(parser).toContain("resultCode != Activity.RESULT_OK")
    const tests = source(
      `${root}test/java/app/codeg/web/FileChooserResultTest.java`
    )
    for (const scenario of [
      "acceptsOneImageReturnedOnlyInClipData",
      "preservesMultipleImagesEvenWithSingleDataUri",
      "acceptsSingleDataUri",
      "cancellationAndMissingResultsDoNotAttachFiles",
    ]) {
      expect(tests).toContain(scenario)
    }
  })
})
