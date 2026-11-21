import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PlayerForm from "../components/PlayerForm";

// The registration / profile form reuses the shared cascading control. The tree
// selection must reach both `locationRefs` (what filters use) and the legacy
// address text (what older screens read).
const TREE = {
  country: [{ _id: "pk", name: "Pakistan", type: "country" }],
  province: [{ _id: "pb", name: "Punjab", type: "province" }],
  district: [{ _id: "lhr", name: "Lahore", type: "district" }],
  city: [{ _id: "lhr-city", name: "Lahore City", type: "city" }],
  town: [],
};

function mockTreeFetch() {
  global.fetch = vi.fn(async (url) => {
    const parsed = new URL(String(url));
    const ids = parsed.searchParams.get("ids");
    if (ids) {
      return { ok: true, json: async () => ({ locations: Object.values(TREE).flat() }) };
    }
    const type = parsed.searchParams.get("type");
    return { ok: true, json: async () => ({ locations: TREE[type] || [] }) };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlayerForm location integration", () => {
  it("writes the chosen branch into the address fields and the refs", async () => {
    mockTreeFetch();
    const onSubmit = vi.fn();
    render(<PlayerForm mode="user" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Province / Territory"), { target: { value: "Punjab" } });
    await waitFor(() => expect(screen.getByPlaceholderText("Province")).toHaveValue("Punjab"));

    fireEvent.change(screen.getByLabelText("District"), { target: { value: "Lahore" } });
    await waitFor(() => expect(screen.getByPlaceholderText("District")).toHaveValue("Lahore"));

    fireEvent.change(screen.getByLabelText("City / Tehsil"), { target: { value: "Lahore City" } });
    await waitFor(() => expect(screen.getByPlaceholderText("City")).toHaveValue("Lahore City"));

    // Changing the province above must clear the deeper levels and their text,
    // so a saved record can never claim a stale city.
    fireEvent.change(screen.getByLabelText("Province / Territory"), { target: { value: "" } });
    await waitFor(() => expect(screen.getByPlaceholderText("City")).toHaveValue(""));
    expect(screen.getByPlaceholderText("District")).toHaveValue("");
  });

  it("defaults the country to Pakistan without the user choosing it", async () => {
    mockTreeFetch();
    render(<PlayerForm mode="user" onSubmit={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Country")).toHaveValue("Pakistan")
    );
  });
});
