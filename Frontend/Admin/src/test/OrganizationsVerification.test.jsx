import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("../services/api", () => ({ api, default: api }));

vi.mock("../components/ConfirmModal", () => ({
  default: ({ open, title, confirmLabel, onConfirm, onCancel }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel || "Confirm"}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

import Organizations from "../pages/Organizations";

const PENDING = {
  _id: "org-pending-1",
  name: "Pending Registration Club",
  shortName: "PRC",
  type: "club",
  orgType: "registered_club",
  verificationStatus: "pending",
  typeDetails: {
    registrationNumber: "DO-NOT-SHOW-PUBLICLY",
    registrationAuthority: "Board",
  },
  owner: { name: "Owner One", email: "owner@example.test" },
  isActive: true,
  category: null,
};

const VERIFIED = {
  ...PENDING,
  _id: "org-verified-2",
  name: "Verified School",
  shortName: "VS",
  type: "school",
  orgType: "school",
  verificationStatus: "verified",
  typeDetails: { institutionName: "Riverside School" },
};

describe("Admin organizations verification queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === "/organizations") {
        return Promise.resolve({ data: { items: [PENDING, VERIFIED], total: 2 } });
      }
      if (url === "/team-categories") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    api.post.mockResolvedValue({ data: { organization: {} } });
    localStorage.clear();
  });

  it("shows the type label and badge without leaking registration numbers", async () => {
    render(<Organizations />);

    expect(await screen.findByText("Pending Registration Club")).toBeTruthy();
    const row = screen.getByText("Pending Registration Club").closest("tr");
    expect(within(row).getByText("Registered club")).toBeTruthy();
    expect(within(row).getByText("Pending review")).toBeTruthy();
    expect(screen.queryByText("DO-NOT-SHOW-PUBLICLY")).toBeNull();

    expect(within(row).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("passes verification and type filters to the API", async () => {
    render(<Organizations />);
    await screen.findByText("Pending Registration Club");

    fireEvent.change(screen.getByLabelText("Filter by verification status"), {
      target: { value: "pending" },
    });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/organizations",
        expect.objectContaining({
          params: expect.objectContaining({ verificationStatus: "pending" }),
        })
      )
    );

    fireEvent.change(screen.getByLabelText("Filter by organization type"), {
      target: { value: "registered_club" },
    });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        "/organizations",
        expect.objectContaining({
          params: expect.objectContaining({
            verificationStatus: "pending",
            orgType: "registered_club",
          }),
        })
      )
    );
  });

  it("records an admin approve decision through the verification endpoint", async () => {
    render(<Organizations />);
    const row = await screen.findByRole("row", { name: /Pending Registration Club/ });
    fireEvent.click(within(row).getByRole("button", { name: "Approve" }));

    expect(screen.getByText("Approve verification")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/organizations/org-pending-1/verification/approve",
        expect.objectContaining({ note: "" })
      )
    );
    expect(await screen.findByText(/"Pending Registration Club" verified/)).toBeTruthy();
  });
});
