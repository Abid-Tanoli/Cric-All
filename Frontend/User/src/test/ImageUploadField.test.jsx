import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImageUploadField, { imageUploadPath } from "../components/ImageUploadField.jsx";

const uploadOrgImage = vi.fn();
const deleteOrgImage = vi.fn();

vi.mock("../services/organizationApi", () => ({
  uploadOrgImage: (...args) => uploadOrgImage(...args),
  deleteOrgImage: (...args) => deleteOrgImage(...args),
}));

describe("ImageUploadField", () => {
  beforeEach(() => {
    uploadOrgImage.mockReset();
    deleteOrgImage.mockReset();
  });

  it("uploads through the org route and returns a local /uploads URL", async () => {
    uploadOrgImage.mockResolvedValue({ url: "http://backend.test/uploads/abc.webp" });
    const onChange = vi.fn();
    render(<ImageUploadField orgId="org-1" value="" onChange={onChange} />);

    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/add photo/i, { selector: "input[type=file]" }), {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadOrgImage).toHaveBeenCalledWith("org-1", file));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("/uploads/abc.webp"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects a non-image selection without calling the API", async () => {
    const onChange = vi.fn();
    render(<ImageUploadField orgId="org-1" value="" onChange={onChange} />);
    const file = new File(["text"], "evil.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/add photo/i, { selector: "input[type=file]" }), {
      target: { files: [file] },
    });

    expect(uploadOrgImage).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toMatch(/JPG, PNG or WebP/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the server error and lets the user clear a photo", async () => {
    uploadOrgImage.mockRejectedValue(new Error("Quota exceeded"));
    const onChange = vi.fn();
    const { rerender } = render(<ImageUploadField orgId="org-1" value="" onChange={onChange} />);
    const file = new File([new Uint8Array([1])], "photo.webp", { type: "image/webp" });
    fireEvent.change(screen.getByLabelText(/add photo/i, { selector: "input[type=file]" }), {
      target: { files: [file] },
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Quota exceeded/);

    rerender(<ImageUploadField orgId="org-1" value="/uploads/abc.webp" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(deleteOrgImage).toHaveBeenCalledWith("org-1", "abc.webp");
  });

  it("normalizes absolute backend URLs to a local /uploads path", () => {
    expect(imageUploadPath({ url: "https://backend.example/uploads/hash.webp" })).toBe("/uploads/hash.webp");
    expect(imageUploadPath({ url: "/uploads/hash.webp" })).toBe("/uploads/hash.webp");
    expect(imageUploadPath({ url: "https://evil.test/photo.webp" })).toBe("");
  });
});
