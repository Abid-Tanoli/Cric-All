// T2.2: Admin runs React 18 and User runs React 19. The shared readable UI
// components must work in both (full checks: User/src/test/readableUiComponents.test.jsx).
import React, { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import BigButton from "@shared/ui/BigButton";
import Card from "@shared/ui/Card";
import Sheet from "@shared/ui/Sheet";
import Field from "@shared/ui/Field";

describe("readable UI components on React 18", () => {
  it("BigButton renders and forwards its ref", () => {
    const ref = createRef();
    render(<BigButton ref={ref}>Start match</BigButton>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Start match" }));
  });

  it("Card renders its heading", () => {
    render(<Card as="section" title="Today">Body</Card>);
    expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument();
  });

  it("Field links label, input and Urdu help", () => {
    render(<Field label="Club name" urduHelp="اپنے کلب کا نام لکھیں" />);
    expect(screen.getByLabelText("Club name")).toHaveAccessibleDescription("اپنے کلب کا نام لکھیں");
  });

  it("Sheet opens with focus inside and closes on Escape", () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="How out?"><BigButton>Bowled</BigButton></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "How out?" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
