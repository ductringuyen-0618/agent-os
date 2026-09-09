import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders blocked with danger styling", () => {
    render(<StatusBadge status="blocked" />);
    const badge = screen.getByText("blocked");
    expect(badge).toHaveClass("text-danger");
  });
});
