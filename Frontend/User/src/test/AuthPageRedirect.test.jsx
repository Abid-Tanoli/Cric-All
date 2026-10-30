import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AuthPage from "../pages/auth/AuthPage";
import { api } from "../services/api";

function mockLogin(user) {
  const calls = [];
  api.defaults.adapter = async (config) => {
    calls.push({ method: config.method, url: config.url });
    return {
      data: { token: "login-token", user },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  return calls;
}

function renderAuthPage() {
  return render(
    <MemoryRouter initialEntries={["/login?next=/organization"]}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/change-password" element={<p>Change password screen</p>} />
        <Route path="/organization" element={<p>Organization dashboard</p>} />
      </Routes>
    </MemoryRouter>
  );
}

async function submitLogin() {
  fireEvent.change(screen.getByPlaceholderText(/your@email.com/i), {
    target: { value: "owner@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
    target: { value: "temporary-pass-123" },
  });
  const buttons = screen.getAllByRole("button", { name: /^login$/i });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("AuthPage post-login routing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sends an owner with a temporary password to the change-password screen", async () => {
    mockLogin({
      _id: "65b1000000000000000000aa",
      name: "Owner",
      passwordSet: true,
      mustChangePassword: true,
    });
    renderAuthPage();
    await submitLogin();

    expect(await screen.findByText("Change password screen")).toBeTruthy();
    expect(localStorage.getItem("bq_token")).toBe("login-token");
  });

  it("keeps the requested destination for a normal login", async () => {
    mockLogin({
      _id: "65b1000000000000000000aa",
      name: "Normal",
      passwordSet: true,
      mustChangePassword: false,
    });
    renderAuthPage();
    await submitLogin();

    expect(await screen.findByText("Organization dashboard")).toBeTruthy();
  });
});
