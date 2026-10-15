import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { get, put, showToast } = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock("../services/api", () => ({ default: { get, put } }));
vi.mock("../components/Toast", () => ({ useToast: () => ({ showToast }) }));

import ScorerAssignment from "../pages/ScorerAssignment";

const MATCH = {
  _id: "m1",
  title: "OPENCODE_TEST QF1",
  status: "live",
  teams: [{ _id: "A", name: "Alpha" }, { _id: "B", name: "Beta" }],
  organizationRef: "org1",
  assignedScorers: [],
};

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  showToast.mockReset();
  get.mockImplementation((url) => {
    if (url === "/matches?limit=200") return Promise.resolve({ data: [MATCH] });
    if (url === "/organizations/org1/members?limit=200") {
      return Promise.resolve({
        data: {
          items: [
            { _id: "mem1", user: { _id: "u1", name: "Ann", email: "ann@openctest.dev" }, roles: ["score_handler"] },
            { _id: "mem2", user: { _id: "u2", name: "Ben", email: "ben@openctest.dev" }, roles: ["score_handler", "manager"] },
          ],
        },
      });
    }
    return Promise.resolve({ data: [] });
  });
  put.mockResolvedValue({ data: { assignedScorers: [{ _id: "u1", name: "Ann" }] } });
});

describe("ScorerAssignment", () => {
  it("renders the assignment form", async () => {
    render(<ScorerAssignment />);
    expect(screen.getByRole("heading", { name: /scorer assignment/i })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /alpha v beta/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save assignment/i })).toBeInTheDocument();
  });

  it("lists the club members for the chosen fixture and saves the ticks", async () => {
    render(<ScorerAssignment />);

    fireEvent.change(await screen.findByLabelText("Fixture"), { target: { value: "m1" } });

    const ann = await screen.findByLabelText("assign Ann");
    fireEvent.click(ann);
    fireEvent.click(screen.getByRole("button", { name: /save assignment/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, payload] = put.mock.calls[0];
    expect(url).toBe("/matches/m1/scorers");
    expect(payload).toEqual({ scorerIds: ["u1"] });
    expect(showToast).toHaveBeenCalledWith("Scorer assigned", "success");
  });
});
