import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import LocationSelect from "../../../Shared/components/LocationSelect.jsx";
import LocationFilters, { locationQueryFromSearchParams } from "../components/LocationFilters";

const TREE = {
  country: [{ _id: "pk", name: "Pakistan", type: "country" }],
  province: [{ _id: "pb", name: "Punjab", type: "province" }],
  district: [
    { _id: "lhr", name: "Lahore", type: "district" },
    { _id: "ksr", name: "Kasur", type: "district" },
  ],
  city: [
    { _id: "lhr-city", name: "Lahore City", type: "city" },
    { _id: "kasur", name: "Kasur", type: "city" },
  ],
  town: [{ _id: "mt", name: "Model Town", type: "town" }],
};

function mockTreeFetch() {
  return vi.fn(async (url, options = {}) => {
    if (String(url).includes("/locations/suggest") && options.method === "POST") {
      return {
        ok: true,
        json: async () => ({
          location: { _id: "pending-1", name: "New Area", type: "town", approved: false },
        }),
      };
    }
    const parsed = new URL(String(url));
    const type = parsed.searchParams.get("type");
    const ids = parsed.searchParams.get("ids");
    if (ids) {
      const all = Object.values(TREE).flat();
      return { ok: true, json: async () => ({ locations: all.filter((row) => ids.split(",").includes(row._id)) }) };
    }
    return { ok: true, json: async () => ({ locations: TREE[type] || [] }) };
  });
}

function Harness({ onChange }) {
  const [refs, setRefs] = useState({});
  const [labels, setLabels] = useState({});
  return (
    <LocationSelect
      value={refs}
      labels={labels}
      onChange={(next, nextLabels) => {
        setRefs(next);
        setLabels(nextLabels);
        onChange?.(next, nextLabels);
      }}
    />
  );
}

const provinceInput = () => screen.getByLabelText("Province / Territory");
const districtInput = () => screen.getByLabelText("District");
const cityInput = () => screen.getByLabelText("City / Tehsil");
const countryInput = () => screen.getByLabelText("Country");

describe("LocationSelect", () => {
  beforeEach(() => {
    global.fetch = mockTreeFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults the country to Pakistan and enables the next level", async () => {
    render(<Harness />);
    await waitFor(() => expect(countryInput()).toHaveValue("Pakistan"));
    await waitFor(() => expect(provinceInput()).not.toBeDisabled());
    expect(districtInput()).toBeDisabled();
  });

  it("cascades parent → child and resets deeper levels when a parent changes", async () => {
    render(<Harness />);
    await waitFor(() => expect(provinceInput()).not.toBeDisabled());

    fireEvent.change(provinceInput(), { target: { value: "Punjab" } });
    await waitFor(() => expect(districtInput()).not.toBeDisabled());
    fireEvent.change(districtInput(), { target: { value: "Lahore" } });
    await waitFor(() => expect(cityInput()).not.toBeDisabled());
    fireEvent.change(cityInput(), { target: { value: "Lahore City" } });
    await waitFor(() => expect(cityInput()).toHaveValue("Lahore City"));

    // Changing the district clears the city below it; the level stays enabled
    // because its new parent is chosen.
    fireEvent.change(districtInput(), { target: { value: "Kasur" } });
    await waitFor(() => expect(districtInput()).toHaveValue("Kasur"));
    expect(cityInput()).toHaveValue("");
  });

  it("selects a child from typed search text", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await waitFor(() => expect(provinceInput()).not.toBeDisabled());

    fireEvent.change(provinceInput(), { target: { value: "Punjab" } });
    await waitFor(() => expect(districtInput()).not.toBeDisabled());
    fireEvent.change(districtInput(), { target: { value: "Lah" } });
    expect(districtInput()).toHaveValue("Lah");
    // The exact-name commit happens when the option is chosen (datalist change);
    // typing alone must not invent a selection.
    expect(onChange.mock.calls.at(-1)?.[0]?.districtId ?? "").not.toBe("lhr");

    fireEvent.change(districtInput(), { target: { value: "Lahore" } });
    await waitFor(() => expect(onChange.mock.calls.at(-1)[0].districtId).toBe("lhr"));
  });

  it("adds a pending place through the Other flow and selects it", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await waitFor(() => expect(provinceInput()).not.toBeDisabled());
    fireEvent.change(provinceInput(), { target: { value: "Punjab" } });
    await waitFor(() => expect(districtInput()).not.toBeDisabled());
    fireEvent.change(districtInput(), { target: { value: "Lahore" } });
    await waitFor(() => expect(cityInput()).not.toBeDisabled());
    fireEvent.change(cityInput(), { target: { value: "Lahore City" } });
    await waitFor(() => expect(cityInput()).toHaveValue("Lahore City"));

    const addButtons = screen.getAllByRole("button", { name: /Other \(add new\)/i });
    fireEvent.click(addButtons.at(-1));

    fireEvent.change(screen.getByLabelText("New Town / Area name"), { target: { value: "New Area" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onChange.mock.calls.at(-1)[0].townId).toBe("pending-1"));
    expect(screen.getByLabelText("Town / Area")).toHaveValue("New Area");
  });

  it("shows the legacy free-text hint without overwriting the dropdowns", async () => {
    render(
      <LocationSelect
        value={{}}
        labels={{}}
        legacyHint="Old City, Pakistan"
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/Saved address \(legacy\):/i)).toBeInTheDocument();
    expect(screen.getByText("Old City, Pakistan")).toBeInTheDocument();
  });
});

function RouteProbe() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return <p data-testid="query">{JSON.stringify(locationQueryFromSearchParams(params))}</p>;
}

describe("LocationFilters", () => {
  beforeEach(() => {
    global.fetch = mockTreeFetch();
  });

  it("writes the chosen branch to the URL so the view is shareable", async () => {
    render(
      <MemoryRouter initialEntries={["/teams"]}>
        <LocationFilters />
        <RouteProbe />
      </MemoryRouter>
    );

    // The panel starts collapsed; open it.
    fireEvent.click(screen.getByRole("button", { name: /^Location/i }));

    // Filters do not force a default country, so pick one first.
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "Pakistan" } });
    await waitFor(() => expect(screen.getByLabelText("Province / Territory")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Province / Territory"), { target: { value: "Punjab" } });
    await waitFor(() => expect(screen.getByLabelText("District")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("District"), { target: { value: "Lahore" } });

    await waitFor(() => {
      const query = JSON.parse(screen.getByTestId("query").textContent);
      expect(query.province).toBe("pb");
      expect(query.district).toBe("lhr");
    });
  });

  it("clearing removes every location parameter", async () => {
    render(
      <MemoryRouter initialEntries={["/teams?district=lhr&province=pb"]}>
        <LocationFilters />
        <RouteProbe />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /^Clear$/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/i }));
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId("query").textContent)).toEqual({});
    });
  });
});
