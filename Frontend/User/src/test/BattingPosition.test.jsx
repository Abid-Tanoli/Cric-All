import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import PlayerForm from "../components/PlayerForm";
import SquadSection from "../components/SquadSection";
import MatchInfoTab from "../components/MatchInfoTab";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";
import { BATTING_POSITION_OPTIONS } from "@shared/battingPositions";

const selectValues = (select) => Array.from(select.querySelectorAll("option")).map((o) => o.value);
const selectLabels = (select) => Array.from(select.querySelectorAll("option")).map((o) => o.textContent);

describe("User registration form — batting position", () => {
  it("offers Not set plus the four canonical options", () => {
    const { container } = render(<PlayerForm mode="user" onSubmit={vi.fn()} />);
    const select = container.querySelector('select[name="battingPosition"]');

    expect(selectValues(select)).toEqual(["", ...BATTING_POSITION_OPTIONS.map((o) => o.value)]);
    expect(selectLabels(select)).toEqual(["Not set", "Opener", "Middle Order", "Lower Order", "Tailender"]);
  });

  it("submits the chosen position with the registration payload", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PlayerForm
        mode="user"
        onSubmit={onSubmit}
        defaultValues={{
          name: "New Player",
          email: "new@example.com",
          password: "password-123",
          playingRole: "All-Rounder",
          battingStyle: "Left-handed",
          bowlingStyle: "Left-arm Orthodox",
          battingPosition: "middle_order",
          address: { city: "Karachi", province: "Sindh" },
        }}
      />
    );

    fireEvent.change(container.querySelector('select[name="battingPosition"]'), {
      target: { value: "opener" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create player account/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ battingPosition: "opener" });
  });
});

describe("Public squad and XI rendering", () => {
  const withPosition = { _id: "p1", name: "Ann", playingRole: "Batsman", battingPosition: "middle_order" };
  const withoutPosition = { _id: "p2", name: "Ben", playingRole: "Bowler" };

  it("shows the badge in a squad row only for the player who has a position", () => {
    render(
      <SquadSection
        title="Squad"
        players={[withPosition, withoutPosition]}
        allPlayers={[withPosition, withoutPosition]}
      />
    );

    expect(screen.getByText("Middle Order")).toBeInTheDocument();
    expect(screen.getAllByTestId("batting-position-badge")).toHaveLength(1);

    const benRow = screen.getByText("Ben").closest("div");
    expect(benRow).not.toHaveTextContent("Middle Order");
    expect(benRow).not.toHaveTextContent("Not set");
  });

  it("shows positions beside the public Playing XI names", () => {
    const match = {
      _id: "m1",
      teams: [{ _id: "t1", name: "Alpha XI" }],
      playingXI: [
        {
          team: { _id: "t1", name: "Alpha XI" },
          players: [withPosition, withoutPosition],
        },
      ],
    };

    render(<MatchInfoTab match={match} />);

    expect(screen.getByText("Middle Order")).toBeInTheDocument();
    expect(screen.getAllByTestId("batting-position-badge")).toHaveLength(1);
  });

  it("does not leave a placeholder when no XI player has a position", () => {
    const match = {
      _id: "m2",
      teams: [{ _id: "t2", name: "Beta XI" }],
      playingXI: [{ team: { _id: "t2", name: "Beta XI" }, players: [withoutPosition] }],
    };

    const { container } = render(<MatchInfoTab match={match} />);

    expect(screen.queryByTestId("batting-position-badge")).toBeNull();
    expect(container).not.toHaveTextContent("Not set");
    expect(container).not.toHaveTextContent("—");
  });
});

describe("Badge fallback", () => {
  it("renders nothing for an unset value", () => {
    const { container } = render(<BattingPositionBadge value={null} />);
    expect(container.innerHTML).toBe("");
  });
});
