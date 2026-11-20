import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SponsorStrip from "../components/SponsorStrip";

// The shared image falls back to an inline SVG on error; keep the real
// component so the lazy/fixed-size image markup is part of the assertion.
vi.mock("../../../Shared/components/SafeImage.jsx", () => ({
  default: ({ src, alt, ...props }) => <img src={src} alt={alt} {...props} />,
}));

const title = {
  _id: "title-1",
  name: "Title Cricket",
  logoUrl: "/uploads/title.png",
  linkUrl: "https://title.example",
  tier: "title",
  order: 0,
};
const supporting = {
  _id: "support-1",
  name: "Support Sports",
  logoUrl: "/uploads/support.png",
  linkUrl: "https://wa.me/15551234567",
  tier: "supporting",
  order: 2,
};

describe("SponsorStrip", () => {
  it("renders nothing when there are no sponsors", () => {
    const { container } = render(<SponsorStrip sponsors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the title sponsor prominently and supporting sponsors in a row", () => {
    render(<SponsorStrip sponsors={[supporting, title]} />);

    expect(screen.getByLabelText("Sponsored by")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Title Cricket")).toBeInTheDocument();
    expect(screen.getByText("Support Sports")).toBeInTheDocument();
    expect(screen.getByTestId("supporting-sponsors")).toContainElement(screen.getByText("Support Sports"));

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer sponsored");
    }
    expect(links[0]).toHaveAttribute("href", "https://title.example");
    expect(links[1]).toHaveAttribute("href", "https://wa.me/15551234567");
  });

  it("lazy-loads logos in fixed boxes and never renders an AdSlot", () => {
    const { container } = render(<SponsorStrip sponsors={[title, supporting]} compact />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image.className).toContain("h-full");
    }
    expect(container.querySelector(".adsbygoogle")).toBeNull();
    expect(container.querySelector("ins")).toBeNull();
  });

  it("renders a plain label when there is no link", () => {
    const { container } = render(<SponsorStrip sponsors={[{ ...supporting, linkUrl: "" }]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Support Sports")).toBeInTheDocument();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
