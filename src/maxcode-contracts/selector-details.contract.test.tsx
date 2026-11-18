import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"

describe("reference menu details", () => {
  it("recognizes the current adapter's Auto review preset without relabeling Agent", () => {
    const { rerender } = render(
      <DropdownRadioItemContent
        configId="mode"
        valueId="agent"
        label="Auto review"
        description="仅对检测到的潜在风险操作请求批准。"
      />
    )
    expect(screen.getByText("自动风险识别可能存在遗漏")).toBeVisible()
    rerender(
      <DropdownRadioItemContent configId="mode" valueId="agent" label="Agent" />
    )
    expect(
      screen.queryByText("Automatic risk detection may miss unsafe actions")
    ).not.toBeInTheDocument()
  })
  it("keeps Ultra's name and renders its decorative lightning", () => {
    const { container } = render(
      <DropdownRadioItemContent
        configId="reasoning_effort"
        valueId="ultra"
        label="Ultra"
        description="最高推理深度，并自动委派任务"
      />
    )
    expect(screen.getByText("Ultra")).toBeVisible()
    expect(container.querySelector(".lucide-zap")).toHaveAttribute(
      "aria-hidden",
      "true"
    )
  })
  it("shows a subtle full-access risk hint without renaming the option", () => {
    const { container } = render(
      <DropdownRadioItemContent
        configId="mode"
        valueId="agent-full-access"
        label="Full access"
        description="允许修改工作区外的文件，并运行可访问网络的命令。"
      />
    )
    expect(screen.getByText("Full access")).toBeVisible()
    expect(screen.getByText("建议仅在可信环境中启用")).toBeVisible()
    expect(container.querySelector(".lucide-shield-alert")).not.toBeNull()
  })
  it("does not decorate a custom model named Ultra", () => {
    const { container } = render(
      <DropdownRadioItemContent
        configId="model"
        valueId="ultra"
        label="Ultra"
      />
    )
    expect(container.querySelector(".lucide-zap")).toBeNull()
  })
})
