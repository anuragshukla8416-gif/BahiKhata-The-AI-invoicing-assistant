import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./src/App.jsx";
import { totals } from "./src/lib.js";

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

const PARSED = {
  client_name: "Meera Shah", client_email: "meera@studiokora.in", currency: "INR", tax_name: "IGST",
  items: [
    { name: "Brand identity", quantity: 3, unit_price: 8000, tax_rate: 18 },
    { name: "Print files", quantity: 1, unit_price: 2500, tax_rate: 18 },
  ],
  due_date: "2026-11-02", notes: "",
};
const ROWS = [
  { id: "1", invoice_number: "0007", client_name: "Studio Kora", client_email: "a@b.co", total: 11800, currency: "INR", due_date: "2026-10-02", status: "SENT", days_overdue: 16, reminders_sent: 1, items: [] },
  { id: "2", invoice_number: "0008", client_name: "Northwind", client_email: "a@b.co", total: 1450.5, currency: "USD", due_date: "2026-11-05", status: "PAID", days_overdue: 0, reminders_sent: 0, items: [] },
  { id: "3", invoice_number: "0009", client_name: "Fieldnotes", client_email: "a@b.co", total: 640, currency: "USD", due_date: "2026-11-20", status: "DRAFT", days_overdue: 0, reminders_sent: 0, items: [] },
];
let calls, state;

beforeEach(() => {
  calls = [];
  state = { rows: ROWS, parsed: PARSED, createError: null };
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method ?? "GET";
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push([method, url, body]);
    const ok = (data) => ({ ok: true, json: async () => structuredClone(data) });
    if (url === "/api/invoices" && method === "GET") return ok(state.rows);
    if (url === "/api/parse") return ok(state.parsed);
    if (url === "/api/invoices" && method === "POST") {
      if (state.createError) return { ok: false, statusText: "x", json: async () => ({ detail: state.createError }) };
      return ok({ id: "new", invoice_number: "0010", status: "DRAFT", client_email: body.client_email });
    }
    if (url.endsWith("/send")) return ok({ id: "new", invoice_number: "0010", status: "SENT", client_email: "meera@studiokora.in" });
    if (url.endsWith("/followup")) return ok({ subject: "Nudge", body: "Hi Studio", tone: 1 });
    if (url.endsWith("/remind")) return ok({});
    return { ok: false, statusText: "nope", json: async () => ({}) };
  });
});
afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

const open = (path) => {
  window.history.pushState({}, "", path);
  return render(<App />);
};
const post = (u) => calls.find((c) => c[0] === "POST" && c[1] === u);

async function fillFromNotes() {
  open("/app");
  fireEvent.change(screen.getByLabelText(/Write it the way/), { target: { value: "notes for Meera, 3 days at 8000" } });
  fireEvent.click(screen.getByText("Read my notes"));
  await screen.findByDisplayValue("meera@studiokora.in");
}

test("landing page shows the product, a sample invoice and legal links", () => {
  open("/");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/client notes into a PayPal invoice/);
  expect(screen.getAllByText("Open the studio").length).toBeGreaterThan(1);
  expect(screen.getByText("₹31,270.00")).toBeTruthy();
  expect(screen.getByAltText(/BahiKhata logo/)).toBeTruthy();
  expect(screen.getByText("Privacy Policy").getAttribute("href")).toBe("/privacy");
  expect(screen.getByText("Terms").getAttribute("href")).toBe("/terms");
  expect(document.body.textContent).not.toMatch(/undefined|NaN/);
});

test("links navigate without a page load and the title follows", async () => {
  open("/");
  fireEvent.click(screen.getAllByText("Open the studio")[0]);
  expect(window.location.pathname).toBe("/app");
  await screen.findByText("Your notes");
  expect(document.title).toBe("Studio | BahiKhata");
  fireEvent.click(screen.getByText("Ledger"));
  expect(window.location.pathname).toBe("/app/ledger");
  await screen.findByText("Studio Kora");
  expect(document.title).toBe("Ledger | BahiKhata");
});

test("privacy and terms pages are real pages with contact details", () => {
  open("/privacy");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Privacy Policy");
  expect(screen.getAllByText("anuragshukla8416@gmail.com")[0].getAttribute("href")).toBe("mailto:anuragshukla8416@gmail.com");
  expect(screen.getByText("OpenAI")).toBeTruthy();
  cleanup();
  open("/terms");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Terms and Conditions");
  expect(screen.getByText(/GST or IGST|choice between GST and IGST/)).toBeTruthy();
  const links = screen.getAllByText("Privacy Policy");
  expect(links.length).toBeGreaterThan(1);
  expect(links.every((a) => a.getAttribute("href") === "/privacy")).toBe(true);
});

test("unknown paths show a not-found page with a way home", () => {
  open("/nope");
  expect(screen.getByText("That page doesn't exist")).toBeTruthy();
  expect(document.title).toMatch(/not found/i);
});

test("no em or en dashes in any page copy", () => {
  for (const path of ["/", "/app", "/privacy", "/terms"]) {
    open(path);
    expect(document.body.textContent, path).not.toMatch(/[–—]/);
    cleanup();
  }
});

test("reading notes fills the form and the live sheet, tax included", async () => {
  await fillFromNotes();
  expect(post("/api/parse")[2]).toEqual({ text: "notes for Meera, 3 days at 8000" });
  expect(screen.getByDisplayValue("Brand identity")).toBeTruthy();
  expect(screen.getByLabelText("Tax type").value).toBe("IGST");
  expect(screen.getByLabelText("Currency").value).toBe("INR");
  const sheet = screen.getByLabelText("Invoice preview");
  expect(within(sheet).getByText("Meera Shah")).toBeTruthy();
  expect(within(sheet).getByText("₹31,270.00")).toBeTruthy();
  expect(within(sheet).getByText("IGST 18%")).toBeTruthy();
  expect(screen.getByText("Everything was filled in. Check it before you create the draft.")).toBeTruthy();
});

test("editing a line updates the sheet total immediately", async () => {
  await fillFromNotes();
  fireEvent.change(screen.getByLabelText("Line 2 rate"), { target: { value: "5000" } });
  expect(within(screen.getByLabelText("Invoice preview")).getByText("₹34,220.00")).toBeTruthy();
});

test("parse results with gaps are called out", async () => {
  state.parsed = { ...PARSED, client_email: null, due_date: null, items: [{ name: "Logo", quantity: 1, unit_price: null, tax_rate: 0 }] };
  open("/app");
  fireEvent.change(screen.getByLabelText(/Write it the way/), { target: { value: "some vague notes here" } });
  fireEvent.click(screen.getByText("Read my notes"));
  await screen.findByText(/I could not find: client email, some prices, due date/);
});

test("the form refuses to create an invoice until it is valid", () => {
  open("/app");
  fireEvent.click(screen.getByText("Create draft on PayPal"));
  expect(screen.getByRole("alert").textContent).toBe("Add the client's name.");
  expect(post("/api/invoices")).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meera" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
  fireEvent.click(screen.getByText("Create draft on PayPal"));
  expect(screen.getByRole("alert").textContent).toBe("Add a valid client email.");
});

test("create the draft with numbers and tax, then send it", async () => {
  await fillFromNotes();
  fireEvent.click(screen.getByText("Create draft on PayPal"));
  await screen.findByText(/Draft 0010 is saved on PayPal/);
  expect(post("/api/invoices")[2]).toEqual({
    client_name: "Meera Shah", client_email: "meera@studiokora.in", currency: "INR", tax_name: "IGST",
    due_date: "2026-11-02", notes: "",
    items: [
      { name: "Brand identity", quantity: 3, unit_price: 8000, tax_rate: 18 },
      { name: "Print files", quantity: 1, unit_price: 2500, tax_rate: 18 },
    ],
  });
  expect(screen.getByText("Create draft on PayPal").disabled).toBe(true);
  fireEvent.click(screen.getByText("Send to client"));
  await screen.findByText("Invoice 0010 was sent to meera@studiokora.in.");
  expect(post("/api/invoices/new/send")).toBeTruthy();
  fireEvent.click(screen.getByText("Start another"));
  expect(screen.getByLabelText("Name").value).toBe("");
});

test("server errors are shown in plain words", async () => {
  state.createError = "PayPal error 422: INVALID_CURRENCY";
  await fillFromNotes();
  fireEvent.click(screen.getByText("Create draft on PayPal"));
  await screen.findByText("PayPal error 422: INVALID_CURRENCY");
  expect(screen.queryByText(/is saved on PayPal/)).toBeNull();
});

test("an unreachable server gives a readable message", async () => {
  globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
  open("/app/ledger");
  await screen.findByText(/Could not reach the server/);
});

test("ledger lists invoices with badges, formatted money and actions", async () => {
  open("/app/ledger");
  await screen.findByText("Studio Kora");
  expect(screen.getByText("3 invoices, 1 awaiting payment, 1 overdue.")).toBeTruthy();
  expect(screen.getByText("Overdue 16d")).toBeTruthy();
  expect(screen.getByText("₹11,800.00")).toBeTruthy();
  expect(screen.getByText("$1,450.50")).toBeTruthy();
  expect(screen.getByText("2 Oct 2026")).toBeTruthy();
  expect(screen.getAllByText("Chase")).toHaveLength(1);
  expect(screen.getAllByText("Send")).toHaveLength(1);
});

test("chasing opens an editable reminder and sends the edited text", async () => {
  open("/app/ledger");
  fireEvent.click(await screen.findByText("Chase"));
  const subject = await screen.findByDisplayValue("Nudge");
  expect(screen.getByText("Firm reminder")).toBeTruthy();
  fireEvent.change(subject, { target: { value: "Edited subject" } });
  fireEvent.click(screen.getByText("Send through PayPal"));
  await waitFor(() => expect(post("/api/invoices/1/remind")).toBeTruthy());
  expect(post("/api/invoices/1/remind")[2]).toEqual({ subject: "Edited subject", body: "Hi Studio" });
  await waitFor(() => expect(screen.queryByDisplayValue("Edited subject")).toBeNull());
});

test("a payment that arrives by webhook shows on the next reload", async () => {
  open("/app/ledger");
  await screen.findByText("Overdue 16d");
  state.rows = state.rows.map((r) => (r.id === "1" ? { ...r, status: "PAID", days_overdue: 0 } : r));
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() => expect(screen.queryByText("Overdue 16d")).toBeNull());
  expect(screen.queryByText("Chase")).toBeNull();
  expect(screen.getAllByText("PAID")).toHaveLength(2);
});

test("an empty ledger invites the first invoice", async () => {
  state.rows = [];
  open("/app/ledger");
  await screen.findByText("The ledger is empty");
  expect(screen.getByText("Create the first invoice").getAttribute("href")).toBe("/app");
});

test("totals match the backend's per-line rounding", () => {
  const t = totals([
    { quantity: 12, unit_price: 60, tax_rate: 18 },
    { quantity: 1, unit_price: 150, tax_rate: 18 },
  ]);
  expect(t.total).toBe(1026.6);
  expect(t.byRate[18]).toBe(15660);
  expect(totals([{ quantity: 1.5, unit_price: 19.99, tax_rate: 0 }]).total).toBe(29.99);
  expect(totals([{ quantity: "", unit_price: "abc", tax_rate: "" }]).total).toBe(0);
});
