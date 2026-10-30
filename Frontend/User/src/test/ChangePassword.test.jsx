import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ChangePassword from "../pages/auth/ChangePassword";
import { api } from "../services/api";

function mockChangePassword() {
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push({
      method: config.method,
      url: config.url,
      body: config.data ? JSON.parse(config.data) : null,
    });
    return {
      data: {
        message: "Password changed successfully.",
        token: "fresh-token",
        user: {
          _id: "65b1000000000000000000aa",
          name: "Owner",
          passwordSet: true,
          mustChangePassword: false,
        },
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  return calls;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/change-password?next=/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<p>Dashboard after change</p>} />
        <Route path="/change-password" element={<ChangePassword />} />
      </Routes>
    </MemoryRouter>
  );
}

function fillNewPasswords() {
  fireEvent.change(screen.getByLabelText(/^new password$/i), {
    target: { value: "new-owner-pass-456" },
  });
  fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
    target: { value: "new-owner-pass-456" },
  });
}

describe("Change password page", () => {
  beforeEach(() => {
    localStorage.setItem("bq_token", "temp-session-token");
    localStorage.setItem(
      "bq_user",
      JSON.stringify({
        _id: "65b1000000000000000000aa",
        name: "Owner",
        passwordSet: true,
        mustChangePassword: true,
      })
    );
  });

  it("requires the current password and persists the fresh session", async () => {
    const calls = mockChangePassword();
    renderPage();

    expect(screen.getByText(/temporary password/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^current password$/i), {
      target: { value: "temporary-pass-123" },
    });
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: /^change password$/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: "post", url: "/auth/change-password" });
    expect(calls[0].body).toEqual({
      currentPassword: "temporary-pass-123",
      newPassword: "new-owner-pass-456",
    });

    await waitFor(() => expect(localStorage.getItem("bq_token")).toBe("fresh-token"));
    const stored = JSON.parse(localStorage.getItem("bq_user"));
    expect(stored.mustChangePassword).toBe(false);

    expect(await screen.findByText("Dashboard after change", {}, { timeout: 2500 })).toBeTruthy();
  });

  it("hides the current-password field for a Google-only account", async () => {
    localStorage.setItem(
      "bq_user",
      JSON.stringify({
        _id: "65b1000000000000000000aa",
        name: "Google Owner",
        passwordSet: false,
        mustChangePassword: false,
      })
    );
    const calls = mockChangePassword();
    renderPage();

    expect(screen.queryByLabelText(/^current password$/i)).toBeNull();
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: /^set password$/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      currentPassword: "",
      newPassword: "new-owner-pass-456",
    });
  });

  it("shows the current-password field when an old cached session lacks passwordSet", async () => {
    localStorage.setItem(
      "bq_user",
      JSON.stringify({
        _id: "65b1000000000000000000aa",
        name: "Legacy Owner",
      })
    );
    const calls = mockChangePassword();
    renderPage();

    fireEvent.change(screen.getByLabelText(/^current password$/i), {
      target: { value: "legacy-pass-123" },
    });
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: /^change password$/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      currentPassword: "legacy-pass-123",
      newPassword: "new-owner-pass-456",
    });
  });

  it("does not call the API when the new passwords do not match", async () => {
    const calls = mockChangePassword();
    renderPage();

    fireEvent.change(screen.getByLabelText(/^current password$/i), {
      target: { value: "temporary-pass-123" },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "new-owner-pass-456" },
    });
    fireEvent.change(screen.getByLabelText(/^confirm new password$/i), {
      target: { value: "different-pass-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^change password$/i }));

    expect(await screen.findByText(/don't match/i)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
