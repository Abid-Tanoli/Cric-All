import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreateOrganization from "../pages/organization/CreateOrganization";
import { api } from "../services/api";
import {
  legacyTypeForOrgType,
  normalizeOrgType,
  orgTypeLabel,
  serializeTypeDetails,
  verificationBadge,
} from "../../../Shared/orgTypes.js";

const ORGANIZATION = {
  _id: "65b100000000000000000001",
  name: "OPENCODE_TEST Registered Club",
  shortName: "Club",
  type: "club",
  orgType: "registered_club",
  location: { city: "", area: "", address: "", country: "" },
  contact: { phone: "", email: "" },
  socialLinks: {},
  privacy: { contactInfo: "public", socialLinks: "public", location: "public" },
};

describe("shared organization type vocabulary", () => {
  it("normalizes legacy slugs and writes a legacy value alongside the enum", () => {
    expect(normalizeOrgType("Business")).toBe("company");
    expect(normalizeOrgType("ngo")).toBe("foundation");
    expect(normalizeOrgType("made-up")).toBe("other");
    expect(legacyTypeForOrgType("registered_club")).toBe("club");
    expect(orgTypeLabel("local_club")).toBe("Local club");
    expect(verificationBadge("verified").label).toBe("Verified");
  });

  it("serializes only fields belonging to the selected type", () => {
    expect(
      serializeTypeDetails("school", {
        institutionName: "  City School ",
        educationLevel: "high",
        registrationNumber: "SHOULD-BE-DROPPED",
      })
    ).toEqual({ institutionName: "City School", educationLevel: "high" });
  });
});

describe("CreateOrganization organization types", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    localStorage.clear();
    localStorage.setItem(
      "bq_user",
      JSON.stringify({
        _id: "65b1000000000000000000aa",
        emailVerified: true,
        accountType: "organization_admin",
      })
    );
    localStorage.setItem("bq_token", "test-token");

    api.defaults.adapter = async (config) => {
      const url = String(config.url || "");
      const method = String(config.method || "get").toLowerCase();
      let data;
      if (url.includes("/organizations/my")) data = [];
      else if (url.includes("/team-categories")) data = [];
      else if (url.includes("/verification/request")) {
        data = { message: "Requested", organization: ORGANIZATION };
      } else if (url.includes("/organizations") && method === "post") {
        data = { organization: ORGANIZATION };
      } else data = { organization: ORGANIZATION };
      calls.push({
        method,
        url,
        data: config.data ? JSON.parse(config.data) : undefined,
      });
      return { data, status: 200, statusText: "OK", headers: {}, config };
    };
  });

  it("shows cards, swaps per-type fields, and requests verification for a registered club", async () => {
    render(
      <MemoryRouter>
        <CreateOrganization />
      </MemoryRouter>
    );

    // The six large branch cards are the first choice; choosing one opens the
    // organization form with that type preselected.
    expect(screen.getAllByRole("button", { name: / \/ / })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Registered club / رجسٹرڈ کلب" }));

    // The form keeps all eight switchable type cards.
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    expect(screen.queryByLabelText("Registration number")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Registered club/ }));
    expect(screen.getByLabelText("Registration number")).toBeTruthy();
    expect(screen.getByLabelText("Founded year")).toBeTruthy();
    expect(screen.getByLabelText(/Request verification after saving/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Riverside Cricket Club" } });
    fireEvent.change(screen.getByLabelText("Registration number"), { target: { value: "REG-77" } });
    fireEvent.change(screen.getByLabelText("Registration authority"), {
      target: { value: "District Cricket Board" },
    });
    fireEvent.click(screen.getByLabelText(/Request verification after saving/));
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

    await waitFor(() => {
      expect(calls.some((call) => call.method === "post" && call.url === "/organizations")).toBe(true);
      expect(calls.some((call) => call.url.includes("/verification/request"))).toBe(true);
    });

    const create = calls.find((call) => call.method === "post" && call.url === "/organizations");
    expect(create.data.orgType).toBe("registered_club");
    expect(create.data.type).toBe("club");
    expect(create.data.typeDetails).toEqual({
      registrationNumber: "REG-77",
      registrationAuthority: "District Cricket Board",
    });
  });
});
