import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SponsorsTab } from "../pages/organization/OrgTournamentDetail";
import {
  createOrgSponsor,
  deleteOrgSponsor,
  listOrgSponsors,
  reorderOrgSponsors,
  updateOrgSponsor,
  uploadOrgSponsorLogo,
} from "../services/organizationApi";

vi.mock("../services/organizationApi", () => ({
  listOrgSponsors: vi.fn(),
  createOrgSponsor: vi.fn(),
  updateOrgSponsor: vi.fn(),
  deleteOrgSponsor: vi.fn(),
  reorderOrgSponsors: vi.fn(),
  uploadOrgSponsorLogo: vi.fn(),
}));

const ORG_ID = "a".repeat(24);
const TOURNAMENT_ID = "b".repeat(24);

const sponsors = [
  {
    _id: "s1",
    name: "Title Co",
    logoUrl: "/uploads/title.png",
    linkUrl: "https://title.example",
    tier: "title",
    order: 0,
    active: true,
  },
  {
    _id: "s2",
    name: "Supporting Co",
    logoUrl: "/uploads/support.png",
    linkUrl: "",
    tier: "supporting",
    order: 1,
    active: true,
  },
];

function renderTab({ canManage = true } = {}) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  render(
    <SponsorsTab
      orgId={ORG_ID}
      tournamentId={TOURNAMENT_ID}
      canManage={canManage}
      onSaved={onSaved}
      onError={onError}
    />
  );
  return { onSaved, onError };
}

const loadedSponsor = () => within(screen.getByTestId("sponsor-list")).findByText("Title Co");

beforeEach(() => {
  vi.clearAllMocks();
  listOrgSponsors.mockResolvedValue(sponsors);
  createOrgSponsor.mockResolvedValue({ _id: "s3" });
  updateOrgSponsor.mockResolvedValue({});
  deleteOrgSponsor.mockResolvedValue({ message: "Sponsor deleted" });
  reorderOrgSponsors.mockResolvedValue(sponsors);
  uploadOrgSponsorLogo.mockResolvedValue({ url: "/uploads/uploaded.png" });
});

describe("organization sponsor management", () => {
  it("loads the tenant-scoped sponsors and previews a draft as it is typed", async () => {
    renderTab();

    expect(await loadedSponsor()).toBeInTheDocument();
    expect(listOrgSponsors).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID);
    expect(within(screen.getByTestId("sponsor-preview")).getByTestId("sponsor-strip")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Sponsor name"), { target: { value: "Draft Co" } });
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "/uploads/draft.png" } });

    expect(within(screen.getByTestId("sponsor-preview")).getByText("Draft Co")).toBeInTheDocument();
  });

  it("creates a sponsor with only the fields the org endpoint accepts", async () => {
    const { onSaved } = renderTab();
    await loadedSponsor();

    fireEvent.change(screen.getByLabelText("Sponsor name"), { target: { value: "New Co" } });
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "/uploads/new.png" } });
    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "https://new.example" } });
    fireEvent.change(screen.getByLabelText("Order"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Add sponsor" }));

    await waitFor(() =>
      expect(createOrgSponsor).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, {
        name: "New Co",
        logoUrl: "/uploads/new.png",
        linkUrl: "https://new.example",
        tier: "supporting",
        order: 4,
        active: true,
      })
    );
    expect(onSaved).toHaveBeenCalledWith("Sponsor added.");
  });

  it("uploads a logo with the sponsor-specific field and fills the logo URL", async () => {
    renderTab();
    await loadedSponsor();

    const file = new File(["png-bytes"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Logo file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload logo" }));

    await waitFor(() => expect(uploadOrgSponsorLogo).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, file));
    expect(screen.getByLabelText("Logo URL")).toHaveValue("/uploads/uploaded.png");
  });

  it("deactivates and reorders sponsors through the pinned org routes", async () => {
    renderTab();
    expect(await loadedSponsor()).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("sponsor-list")).getAllByRole("button", { name: "Deactivate" })[0]);
    await waitFor(() =>
      expect(updateOrgSponsor).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, "s1", { active: false })
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Supporting Co up" }));
    await waitFor(() =>
      expect(reorderOrgSponsors).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, ["s2", "s1"])
    );
  });

  it("deletes a sponsor and reports that the deletion is audited", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onSaved } = renderTab();
    expect(await loadedSponsor()).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(deleteOrgSponsor).toHaveBeenCalledWith(ORG_ID, TOURNAMENT_ID, "s1"));
    expect(onSaved).toHaveBeenCalledWith("Sponsor deleted. The deletion was audited.");
  });

  it("stays read-only for members without competition management", async () => {
    renderTab({ canManage: false });
    expect(await loadedSponsor()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add sponsor" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move Title Co up" })).toBeDisabled();
    expect(within(screen.getByTestId("sponsor-list")).getAllByRole("button", { name: "Deactivate" })[0]).toBeDisabled();
  });
});
