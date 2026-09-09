import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const resources = "android-webview/app/src/main/res"

describe("MaxCode: Android connection chooser", () => {
  it("keeps the approved light palette and original brand artwork", () => {
    const colors = source(`${resources}/values/colors.xml`)
    expect(colors).toContain('<color name="surface">#FFFFFF</color>')
    expect(colors).toContain('<color name="primary_button">#171717</color>')
    expect(source(`${resources}/drawable/brand_small.xml`)).toContain(
      "@drawable/maxcode_icon"
    )
    const layout = source(`${resources}/layout/activity_main.xml`)
    expect(layout).toContain("@drawable/brand_small")
    expect(layout).toContain('android:layout_gravity="bottom"')
    expect(layout).toContain("@+id/form_scroll")
  })

  it("moves management into a menu while retaining delete confirmation", () => {
    const row = source(`${resources}/layout/connection_row.xml`)
    expect(row).toContain("@+id/connection_more_button")
    expect(row).not.toMatch(/@\+id\/(edit|delete)_connection_button/)
    const activity = source(
      "android-webview/app/src/main/java/app/codeg/web/MainActivity.java"
    )
    expect(activity).toContain("new PopupMenu(this, anchor)")
    expect(activity).toContain("showSetup(SetupMode.EDIT, connection, 0)")
    expect(activity).toContain("confirmDeleteConnection(connection)")
    expect(activity).toContain("selectConnection(connection)")
    expect(activity).toContain("closeSetupButton.setEnabled(!connecting)")
  })

  it("keeps adding a connection visually secondary with a touch-sized target", () => {
    const layout = source(`${resources}/layout/activity_main.xml`)
    const addButton = layout.match(
      /<Button\s+android:id="@\+id\/add_connection_button"[\s\S]*?\/>/
    )?.[0]
    expect(addButton).toBeDefined()
    expect(addButton).toContain('android:layout_height="48dp"')
    expect(addButton).toContain('android:layout_width="wrap_content"')
    expect(addButton).toContain('android:textColor="@color/text_secondary"')
    expect(addButton).not.toContain("bg_primary_button")
  })

  it("centers saved-connection content with one horizontal layout", () => {
    const row = source(`${resources}/layout/connection_row.xml`)
    expect(row).not.toContain("RelativeLayout")
    expect(row).not.toContain("layout_centerVertical")
    expect(row).toMatch(
      /<LinearLayout\s+android:id="@\+id\/open_connection_button"\s+android:orientation="horizontal"/
    )
    expect(
      source(
        "android-webview/app/src/test/java/app/codeg/web/ConnectionRowLayoutTest.java"
      )
    ).toContain("keepsLongNamesAndLargerTextCenteredWithoutClipping")
  })
})
