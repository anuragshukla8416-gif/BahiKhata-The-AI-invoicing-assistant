import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App.jsx";
import { getStoredUser, setStoredUser, clearStoredUser, DEMO_USER } from "./auth.js";

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

test("unauthenticated user on landing page sees landing page and sign in button", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBeTruthy();
  expect(screen.getByText("Sign In")).toBeTruthy();
});

test("tapping 'Open Dashboard' from landing page when unauthenticated redirects to login", async () => {
  render(<App />);
  const dashboardLink = screen.getByText("Open Dashboard");
  fireEvent.click(dashboardLink);

  await screen.findByRole("heading", { name: /Sign in to BahiKhata/i });
  expect(window.location.pathname).toBe("/login");
  expect(screen.getByText(/Access restricted/i)).toBeTruthy();
});

test("tapping 'Create an invoice' from landing page when unauthenticated redirects to login", async () => {
  render(<App />);
  const createLink = screen.getByText("Create an invoice");
  fireEvent.click(createLink);

  await screen.findByRole("heading", { name: /Sign in to BahiKhata/i });
  expect(window.location.pathname).toBe("/login");
});

test("instant demo login logs user in and takes them to their target destination", async () => {
  render(<App />);
  fireEvent.click(screen.getByText("Open Dashboard"));

  await screen.findByRole("heading", { name: /Sign in to BahiKhata/i });
  const demoBtn = screen.getByRole("button", { name: /Instant Demo Sign In/i });
  fireEvent.click(demoBtn);

  await waitFor(() => {
    expect(window.location.pathname).toBe("/app/dashboard");
  });
  expect(getStoredUser()).not.toBeNull();
  expect(screen.getByText("Sign Out")).toBeTruthy();
});

test("custom email and password login works properly", async () => {
  render(<App />);
  fireEvent.click(screen.getByText("Sign In"));

  await screen.findByRole("heading", { name: /Sign in to BahiKhata/i });
  fireEvent.change(screen.getByLabelText(/Email Address/i), {
    target: { value: "testuser@bahikhata.in" },
  });
  fireEvent.change(screen.getByLabelText(/^Password$/i), {
    target: { value: "secret123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Sign In to BahiKhata/i }));

  await waitFor(() => {
    expect(window.location.pathname).toBe("/app/dashboard");
  });
  const user = getStoredUser();
  expect(user.email).toBe("testuser@bahikhata.in");
});

test("signing out clears stored user and returns to landing page", async () => {
  setStoredUser(DEMO_USER);
  window.history.pushState({}, "", "/app/dashboard");
  render(<App />);

  await screen.findByText("Sign Out");
  fireEvent.click(screen.getByText("Sign Out"));

  await waitFor(() => {
    expect(window.location.pathname).toBe("/");
  });
  expect(getStoredUser()).toBeNull();
  expect(screen.getByText("Sign In")).toBeTruthy();
});


test("tapping user name on top opens business information modal", async () => {
  setStoredUser(DEMO_USER);
  window.history.pushState({}, "", "/app/dashboard");
  render(<App />);

  const nameBtn = await screen.findByRole("button", { name: /View business profile/i });
  expect(nameBtn).toBeTruthy();
  fireEvent.click(nameBtn);

  // Business Information modal appears
  await screen.findByRole("heading", { name: /Business Information/i });
  expect(screen.getAllByText("Shukla Studio & Accounts").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("anurag@bahikhata.in")).toBeTruthy();
  expect(screen.getByText("● PayPal Sandbox Active")).toBeTruthy();

  // Close modal
  const closeBtn = screen.getByLabelText(/Close dialog/i);
  fireEvent.click(closeBtn);

  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: /Business Information/i })).toBeNull();
  });
});
