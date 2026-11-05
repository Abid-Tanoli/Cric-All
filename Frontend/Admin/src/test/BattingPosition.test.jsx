import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import PlayerForm from "@shared/components/PlayerForm";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";
import { BATTING_POSITION_OPTIONS } from "@shared/battingPositions";

const selectValues = (select) => Array.from(select.querySelectorAll("option")).map((o) => o.value);
const selectLabels = (select) => Array.from(select.querySelectorAll("option")).map((o) => o.textContent);

describe("Admin player form — batting position", () => {
  it("offers Not set plus the four canonical options", () => {
    const { container } = render(<PlayerForm onSubmit={vi.fn()} defaultValues={{}} />);
    const select = container.querySelector('select[name="battingPosition"]');

    expect(select).toBeTruthy();
    expect(selectValues(select)).toEqual(["", ...BATTING_POSITION_OPTIONS.map((o) => o.value)]);
    expect(selectLabels(select)).toEqual(["Not set", "Opener", "Middle Order", "Lower Order", "Tailender"]);
  });

  it("submits the selected value with the rest of the profile", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PlayerForm
        onSubmit={onSubmit}
        defaultValues={{
          name: "Admin Pick",
          playingRole: "Batsman",
          battingStyle: "Right-handed",
          bowlingStyle: "Right-arm Fast",
          battingPosition: "opener",
        }}
      />
    );

    fireEvent.change(container.querySelector('select[name="battingPosition"]'), {
      target: { value: "lower_order" },
    });
    fireEvent.click(screen.getByRole("button", { name: /enlist player/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: "Admin Pick",
      battingPosition: "lower_order",
    });
  });

  it("clears a stored position and submits the empty value", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PlayerForm
        editingId="p1"
        onSubmit={onSubmit}
        defaultValues={{
          name: "Existing",
          playingRole: "Bowler",
          battingStyle: "Left-handed",
          bowlingStyle: "Left-arm Fast",
          battingPosition: "tailender",
        }}
      />
    );

    fireEvent.change(container.querySelector('select[name="battingPosition"]'), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update file/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ battingPosition: "" });
  });

  it("seeds an edit with the stored value instead of resetting it to Not set", () => {
    const { container } = render(
      <PlayerForm
        editingId="p1"
        onSubmit={vi.fn()}
        defaultValues={{
          name: "Existing",
          playingRole: "Bowler",
          battingStyle: "Left-handed",
          bowlingStyle: "Left-arm Fast",
          battingPosition: "tailender",
        }}
      />
    );

    expect(container.querySelector('select[name="battingPosition"]').value).toBe("tailender");
  });

  it("reloads the stored position when create mode switches to editing a player", async () => {
    const { container, rerender } = render(<PlayerForm onSubmit={vi.fn()} defaultValues={{}} />);

    rerender(
      <PlayerForm
        editingId="p1"
        onSubmit={vi.fn()}
        defaultValues={{
          name: "Existing",
          playingRole: "Bowler",
          battingStyle: "Left-handed",
          bowlingStyle: "Left-arm Fast",
          battingPosition: "tailender",
        }}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('input[name="name"]').value).toBe("Existing");
      expect(container.querySelector('select[name="battingPosition"]').value).toBe("tailender");
    });
  });
});

describe("BattingPositionBadge", () => {
  it("shows a human label for a known stored value", () => {
    render(<BattingPositionBadge value="middle_order" />);
    expect(screen.getByTestId("batting-position-badge")).toHaveTextContent("Middle Order");
  });

  it("renders nothing when the field is unset", () => {
    const { container } = render(<BattingPositionBadge value="" />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("batting-position-badge")).toBeNull();
  });

  it("renders nothing for a missing or unknown value (no placeholder)", () => {
    const { container, rerender } = render(<BattingPositionBadge />);
    expect(container.innerHTML).toBe("");

    rerender(<BattingPositionBadge value="sweeper" />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Not set")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });
});
