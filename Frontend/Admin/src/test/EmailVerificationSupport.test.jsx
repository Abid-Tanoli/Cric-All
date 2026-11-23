import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EmailVerificationSupport from "../pages/EmailVerificationSupport";

const get = vi.fn();
const post = vi.fn();

vi.mock("../services/api", () => ({
  default: { get: (...args) => get(...args), post: (...args) => post(...args) },
}));

const unverified = {
  _id: "u1",
  name: "Needs Help",
  email: "help@example.test",
  emailVerified: false,
  phone: "923001234567",
  phoneVerified: false,
};
const verified = {
  _id: "u2",
  name: "All Done",
  email: "done@example.test",
  emailVerified: true,
  phone: "",
  phoneVerified: false,
};

describe("Admin email verification support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { users: [unverified, verified], total: 2, page: 1, pages: 1 } });
    post.mockResolvedValue({
      data: { message: "Email marked verified. The override was recorded in the audit log." },
    });
  });

  it("lists users with their emailVerified state and never offers phone verification", async () => {
    render(<EmailVerificationSupport />);
    expect(await screen.findByText("help@example.test")).toBeInTheDocument();
    expect(screen.getByTestId("email-verified-u1")).toHaveTextContent("Not verified");
    expect(screen.getByTestId("email-verified-u2")).toHaveTextContent("Verified");
    expect(screen.getAllByText("Not verified").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: /verify phone/i })).toBeNull();
    expect(get).toHaveBeenCalledWith("/admin/users", {
      params: { page: 1, limit: 25, search: "" },
    });
  });

  it("marks a user verified with an audited support note and refreshes the list", async () => {
    get
      .mockResolvedValueOnce({ data: { users: [unverified], total: 1, page: 1, pages: 1 } })
      .mockResolvedValue({
        data: {
          users: [{ ...unverified, emailVerified: true }],
          total: 1,
          page: 1,
          pages: 1,
        },
      });

    render(<EmailVerificationSupport />);
    fireEvent.click(await screen.findByRole("button", { name: /mark verified/i }));
    fireEvent.change(screen.getByLabelText(/support note for needs help/i), {
      target: { value: "Mailbox outage" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/admin/users/u1/mark-email-verified", {
        note: "Mailbox outage",
      })
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/recorded in the audit log/i);
    await waitFor(() =>
      expect(screen.getByTestId("email-verified-u1")).toHaveTextContent("Verified")
    );
  });
});
