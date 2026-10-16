import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// P4: a scorer picks the player of the match from the people who actually
// appear in the scorecard, and the pick is PUT to the match.

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("../services/api", () => ({ default: { put } }));

import PlayerOfMatchCard from "../components/ScoreManagement/PlayerOfMatchCard";

const match = (overrides = {}) => ({
  _id: "m1",
  status: "completed",
  manOfMatch: null,
  playingXI: [
    { team: { _id: "t1" }, players: [{ _id: "p1", name: "Ann" }, { _id: "p2", name: "Ben" }] },
    { team: { _id: "t2" }, players: [{ _id: "p3", name: "Cleo" }] },
  ],
  innings: [
    { batting: [{ player: { _id: "p1", name: "Ann" } }], bowling: [{ player: { _id: "p3", name: "Cleo" } }] },
  ],
  ...overrides,
});

const renderCard = (props = {}) => {
  const onSaved = vi.fn();
  const showToast = vi.fn();
  render(
    <PlayerOfMatchCard
      match={props.match || match()}
      onSaved={onSaved}
      showToast={showToast}
    />
  );
  return { onSaved, showToast };
};

describe("PlayerOfMatchCard", () => {
  beforeEach(() => {
    put.mockReset();
    put.mockResolvedValue({ data: { match: { _id: "m1" } } });
  });

  it("offers the players who appear in the scorecard, without duplicates", () => {
    renderCard();
    const select = screen.getByLabelText("Player of the match");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["No player of the match", "Ann", "Ben", "Cleo"]);
  });

  it("saves the chosen player of the match", async () => {
    const { onSaved, showToast } = renderCard();

    fireEvent.change(screen.getByLabelText("Player of the match"), { target: { value: "p3" } });
    fireEvent.click(screen.getByRole("button", { name: /save player of the match/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith("/matches/m1/mom", { playerId: "p3" });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith("Player of the match saved", "success");
  });

  it("clears the award when the empty option is chosen", async () => {
    renderCard({ match: match({ manOfMatch: { _id: "p1", name: "Ann" } }) });

    fireEvent.change(screen.getByLabelText("Player of the match"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save player of the match/i }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/matches/m1/mom", { playerId: "" }));
  });

  it("disables save until the selection changes", () => {
    renderCard({ match: match({ manOfMatch: { _id: "p1", name: "Ann" } }) });
    expect(screen.getByRole("button", { name: /save player of the match/i })).toBeDisabled();
  });

  it("surfaces the server's reason when the pick is refused", async () => {
    put.mockRejectedValue({ response: { data: { message: "The player of the match must belong to one of the two teams." } } });
    const { showToast } = renderCard();

    fireEvent.change(screen.getByLabelText("Player of the match"), { target: { value: "p3" } });
    fireEvent.click(screen.getByRole("button", { name: /save player of the match/i }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        "The player of the match must belong to one of the two teams.",
        "error",
      )
    );
  });

  it("says so when the scorecard lists no players yet", () => {
    renderCard({ match: match({ playingXI: [], innings: [] }) });
    expect(screen.getByText(/no players are listed in this scorecard yet/i)).toBeTruthy();
  });
});
