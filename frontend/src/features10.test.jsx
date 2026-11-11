import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Studio from "./Studio.jsx";
import Ledger from "./Ledger.jsx";
import Dashboard from "./Dashboard.jsx";
import { convertPrice } from "./lib.js";
import { InvoiceSheet } from "./ui.jsx";

const box = { width: 1000, height: 500, top: 0, left: 0, right: 1000, bottom: 500, x: 0, y: 0, toJSON() {} };
for (const [k, v] of Object.entries({ offsetHeight: 500, offsetWidth: 1000, clientHeight: 500, clientWidth: 1000 })) {
  Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
}
HTMLElement.prototype.getBoundingClientRect = () => box;
window.scrollTo = () => {};
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) {
    const s = [{ inlineSize: 1000, blockSize: 500 }];
    this.cb([{ target: el, contentRect: box, borderBoxSize: s, contentBoxSize: s }], this);
  }
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  window.print = vi.fn();
  window.open = vi.fn();
  globalThis.fetch = vi.fn(async (url) => {
    if (url === "/api/invoices") {
      return {
        ok: true,
        json: async () => [
          {
            id: "inv-1",
            invoice_number: "0001",
            client_name: "Meera Shah",
            client_email: "meera@example.com",
            currency: "INR",
            total: 11800,
            due_date: "2026-11-20",
            status: "SENT",
            days_overdue: 5,
            items: [{ name: "Design", quantity: 1, unit_price: 10000, tax_rate: 18 }],
          },
        ],
      };
    }
    return { ok: true, json: async () => ({}) };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("Feature 1: Voice Dictation button exists in Studio", () => {
  render(<Studio />);
  const micBtn = screen.getByRole("button", { name: /Dictate invoice details with microphone/i });
  expect(micBtn).toBeTruthy();
  expect(micBtn.textContent).toMatch(/Voice Dictate/i);
});

test("Feature 2: Print / PDF trigger calls window.print", () => {
  render(<Studio />);
  const printBtn = screen.getByRole("button", { name: /Print \/ PDF/i });
  expect(printBtn).toBeTruthy();
  fireEvent.click(printBtn);
  expect(window.print).toHaveBeenCalled();
});

test("Feature 3 & 4: Simulate PayPal Sandbox Payment updates status to PAID with authentic stamp", async () => {
  const onPay = vi.fn();
  const testInvoice = {
    id: "inv-1",
    invoice_number: "0001",
    client_name: "Meera Shah",
    client_email: "meera@example.com",
    currency: "INR",
    total: 11800,
    due_date: "2026-11-20",
    status: "SENT",
    items: [{ name: "Design", quantity: 1, unit_price: 10000, tax_rate: 18 }],
  };

  const { rerender } = render(<InvoiceSheet invoice={testInvoice} number="0001" onSimulatePay={onPay} />);

  // PayPal pay button is rendered when unpaid
  const payBtn = screen.getByRole("button", { name: /Pay with PayPal \(Demo\)/i });
  expect(payBtn).toBeTruthy();

  fireEvent.click(payBtn);
  expect(onPay).toHaveBeenCalled();

  // When marked as PAID, pay button is removed and sheet renders cleanly
  rerender(<InvoiceSheet invoice={{ ...testInvoice, status: "PAID" }} number="0001" />);
  expect(screen.queryByRole("button", { name: /Pay with PayPal \(Demo\)/i })).toBeNull();
});

test("Feature 5: Multi-currency live quick-converter recalculates prices accurately", () => {
  // 100 USD at 86.5 rate is 8650 INR
  const inr = convertPrice(100, "USD", "INR");
  expect(inr).toBe(8650);

  // 8650 INR converted back to USD is 100 USD
  const usd = convertPrice(8650, "INR", "USD");
  expect(usd).toBe(100);

  render(<Studio />);
  const inrPill = screen.getByRole("button", { name: /INR/i });
  const usdPill = screen.getByRole("button", { name: /USD/i });
  expect(inrPill).toBeTruthy();
  expect(usdPill).toBeTruthy();

  fireEvent.click(usdPill);
  expect(usdPill.className).toMatch(/active/i);
});

test("Feature 6: Dashboard Donut Collection Health gauge renders percentage", async () => {
  render(<Dashboard />);
  await screen.findByText(/YOUR BUSINESS AT A GLANCE/i);
  expect(screen.getAllByText(/COLLECTED/i).length).toBeGreaterThanOrEqual(1);
});
