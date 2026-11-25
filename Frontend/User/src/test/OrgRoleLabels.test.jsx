import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../services/organizationApi", () => ({
  createOrgInvitation: vi.fn(),
  listOrgInvitations: vi.fn(() => Promise.resolve({ items: [] })),
  revokeOrgInvitation: vi.fn(),
}));

import { roleLabel, roleLabels, rolePickerLabel } from "../lib/orgUi";
import OrgInvitations from "../pages/organization/OrgInvitations";

describe("Scorer role label", () => {
  it("shows Scorer everywhere the role is displayed", () => {
    expect(roleLabel("score_handler")).toBe("Scorer");
    expect(roleLabels(["score_handler"])).toBe("Scorer");
  });

  it("names the code string in the invite picker without changing the API value", async () => {
    expect(rolePickerLabel("score_handler")).toBe("Scorer (Score Handler)");
    expect(rolePickerLabel("manager")).toBe("Manager");

    render(
      <OrgInvitations
        orgId="org-1"
        access={{
          permissions: ["invite_members"],
          grantableRoles: ["score_handler", "player"],
        }}
      />
    );
    expect(await screen.findByRole("button", { name: "Scorer (Score Handler)" })).toBeInTheDocument();
  });
});
