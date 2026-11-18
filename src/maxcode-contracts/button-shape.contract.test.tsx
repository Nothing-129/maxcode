import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"

afterEach(cleanup)

it.each(["default", "outline", "secondary", "ghost", "destructive"] as const)(
  "uses compact corners for ordinary %s actions",
  (variant) => {
    render(<Button variant={variant}>Save</Button>)
    expect(screen.getByRole("button")).toHaveClass("rounded-md")
    expect(screen.getByRole("button")).not.toHaveClass("rounded-4xl")
  }
)

it("keeps primary actions and mode controls pill shaped without changing clicks", () => {
  const onClick = vi.fn()
  render(
    <Button shape="pill" onClick={onClick}>
      New conversation
    </Button>
  )
  const button = screen.getByRole("button")
  expect(button).toHaveClass("rounded-full")
  expect(button).not.toHaveClass("rounded-md")
  fireEvent.click(button)
  expect(onClick).toHaveBeenCalledOnce()
})

it("preserves explicit circular floating controls", () => {
  render(<Button size="icon" className="rounded-full" aria-label="Send" />)
  expect(screen.getByRole("button")).toHaveClass("rounded-full")
  expect(screen.getByRole("button")).not.toHaveClass("rounded-md")
})
