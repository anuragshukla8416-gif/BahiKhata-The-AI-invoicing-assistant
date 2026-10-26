import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import { Link } from "./nav.jsx";
import { Stroke, InvoiceSheet } from "./ui.jsx";
import { api, longDate, money } from "./lib.js";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: "#962421",
  backgroundColor: "#FFFFFE",
  foregroundColor: "#1A1A1A",
  borderColor: "#E6E4DD",
  headerBackgroundColor: "#FAFAF6",
  headerTextColor: "#6A665E",
  headerFontWeight: 500,
  rowHoverColor: "#F6F4EE",
  fontFamily: ["IBM Plex Sans", "system-ui", "sans-serif"],
  fontSize: 14,
  borderRadius: 0,
  wrapperBorderRadius: 0,
});

const TONES = ["Friendly", "Firm", "Final notice"];

function normalizeStatus(status) {
  return status === "MARKED_AS_PAID" ? "PAID" : status;
}

function StatusCell({ data }) {
  if (!data) return null;

  const displayStatus = (data.days_overdue || 0) > 0
    ? "OVERDUE"
    : normalizeStatus(data.status);

  const palette = {
    DRAFT: { background: "#F0EEE8", color: "#625D52" },
    SENT: { background: "#E5EEFF", color: "#244F9E" },
    PAID: { background: "#DDF5E7", color: "#17663A" },
    OVERDUE: { background: "#FCE7E5", color: "#962421" },
  };
  const colors = palette[displayStatus] || { background: "#EEEEEE", color: "#333333" };

  return (
    <span
      className={`tag ${displayStatus.toLowerCase()}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 9px",
        borderRadius: 999,
        background: colors.background,
        color: colors.color,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {displayStatus === "OVERDUE" && (data.days_overdue || 0) > 0
        ? `OVERDUE · ${data.days_overdue}d`
        : displayStatus.replaceAll("_", " ")}
    </span>
  );
}

// Click the invoice number to open its saved invoice preview.
function InvoiceNumberCell({ data, context }) {
  if (!data) return null;
  return (
    <button
      type="button"
      onClick={() => context.view(data)}
      title={`View invoice ${data.invoice_number}`}
      aria-label={`View invoice ${data.invoice_number}`}
      style={{
        border: "none",
        padding: 0,
        background: "transparent",
        color: "#962421",
        textDecoration: "underline",
        textUnderlineOffset: "3px",
        cursor: "pointer",
        font: "inherit",
        fontWeight: 600,
      }}
    >
      {data.invoice_number || "View"}
    </button>
  );
}

function ActionCell({ data, context }) {
  if (!data) return null;
  return (
    <div className="actions" style={{ gap: 6, flexWrap: "nowrap" }}>
      <button
        type="button"
        className="btn small quiet"
        onClick={() => context.view(data)}
        title={`View invoice ${data.invoice_number}`}
      >
        View
      </button>
      {data.status === "DRAFT" ? (
        <button type="button" className="btn small" onClick={() => context.send(data)}>
          Send
        </button>
      ) : (data.days_overdue || 0) > 0 ? (
        <button type="button" className="btn small" onClick={() => context.chase(data)}>
          AI Chase
        </button>
      ) : null}
    </div>
  );
}

const invoiceColumn = {
  field: "invoice_number",
  headerName: "Invoice",
  width: 125,
  sortable: true,
  filter: "agTextColumnFilter",
  cellRenderer: InvoiceNumberCell,
};

const client = (narrow) => ({
  field: "client_name",
  headerName: "Client",
  flex: 1,
  minWidth: narrow ? 96 : 140,
  sortable: true,
  filter: "agTextColumnFilter",
});

const amount = (narrow) => ({
  field: "total",
  headerName: "Amount",
  width: narrow ? 118 : 150,
  type: "rightAligned",
  sortable: true,
  filter: "agNumberColumnFilter",
  valueFormatter: (p) => money(Number(p.value), p.data?.currency),
});

const status = {
  headerName: "Status",
  width: 150,
  sortable: true,
  filter: "agTextColumnFilter",
  valueGetter: (p) =>
    (p.data?.days_overdue || 0) > 0
      ? "OVERDUE"
      : normalizeStatus(p.data?.status),
  cellRenderer: StatusCell,
};

const action = {
  headerName: "",
  width: 220,
  sortable: false,
  filter: false,
  pinned: "right",
  lockPinned: true,
  cellRenderer: ActionCell,
};

const wideColumns = [
  invoiceColumn,
  client(false),
  amount(false),
  {
    field: "due_date",
    headerName: "Due",
    width: 130,
    sortable: true,
    filter: "agTextColumnFilter",
    valueFormatter: (p) => longDate(p.value),
  },
  status,
  {
    field: "reminders_sent",
    headerName: "Reminders",
    width: 120,
    type: "rightAligned",
  },
  action,
];

const narrowColumns = [
  invoiceColumn,
  client(true),
  status,
  amount(true),
  {
    field: "due_date",
    headerName: "Due",
    width: 120,
    sortable: true,
    filter: "agTextColumnFilter",
    valueFormatter: (p) => longDate(p.value),
  },
  action,
];

function useNarrow() {
  const query = "(max-width: 700px)";

  const [narrow, setNarrow] = useState(
    () => !!window.matchMedia?.(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;

    const onChange = () => setNarrow(media.matches);

    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, []);

  return narrow;
}

export default function Ledger() {
  const [rows, setRows] = useState(null);
  const [reminder, setReminder] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const gridRef = useRef(null);
  const working = useRef(false);
  const narrow = useNarrow();

  const load = useCallback(
    () =>
      api("/api/invoices")
        .then((response) => {
          setRows(response);
          setError("");
        })
        .catch((e) => {
          setError(e.message);
          throw e;
        }),
    []
  );

  async function run(label, fn) {
    if (working.current) return;

    working.current = true;
    setBusy(label);
    setError("");

    try {
      await fn();
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  // Open the invoice preview using the saved ledger record.
  const view = (row) => {
    setSelectedInvoice({
      ...row,
      items: Array.isArray(row.items) ? row.items : [],
    });
  };

  // Synchronize PayPal statuses, then reload the ledger.
  const refresh = () =>
    run("Refreshing ledger", async () => {
      await api("/api/invoices/sync", {});
      await load();
    });

  useEffect(() => {
    load().catch(() => {});

    const timer = setInterval(() => {
      load().catch(() => {});
    }, 10000);

    return () => clearInterval(timer);
  }, [load]);

  const send = (row) =>
    run("Sending through PayPal", async () => {
      await api(`/api/invoices/${row.id}/send`, {});
      await load();
    });

  const chase = (row) =>
    run("Writing a reminder", async () => {
      const email = await api(`/api/invoices/${row.id}/followup`, {});
      setReminder({ row, ...email });
    });

  const sendReminder = () =>
    run("Sending the reminder", async () => {
      await api(`/api/invoices/${reminder.row.id}/remind`, {
        subject: reminder.subject,
        body: reminder.body,
      });

      setReminder(null);
      await load();
    });

  const context = useMemo(
    () => ({ send, chase, view }),
    [send, chase, view]
  );

  const exportCsv = () => {
    gridRef.current?.api?.exportDataAsCsv({ fileName: "bahikhata-invoice-ledger.csv" });
  };

  const summary = useMemo(() => {
    if (!rows) return "";

    const waiting = rows.filter((row) =>
      ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(
        normalizeStatus(row.status)
      )
    );

    const late = waiting.filter((row) => (row.days_overdue || 0) > 0);

    return `${rows.length} ${
      rows.length === 1 ? "invoice" : "invoices"
    }, ${waiting.length} awaiting payment, ${late.length} overdue.`;
  }, [rows]);

  return (
    <main className="wrap page ledger-page">
      <div className="page-head ledger-page-head">
        <div className="ledger-heading">
          <p className="ledger-eyebrow">Accounts receivable</p>
          <h1>Invoice ledger</h1>
          <p>
            {summary || "Track invoices, monitor payments, and follow up on overdue balances."}
          </p>
        </div>

        <div className="actions">
          {busy ? <Stroke label={busy} /> : null}

          <button
            className="btn quiet small"
            onClick={exportCsv}
            disabled={!rows || rows.length === 0 || !!busy}
            title="Export the current ledger view to CSV"
          >
            Export Ledger
          </button>

          <button
            className="btn quiet small"
            onClick={refresh}
            disabled={!!busy}
          >
            {busy === "Refreshing ledger" ? "Refreshing..." : "Refresh"}
          </button>

          <Link to="/app" className="btn small">
            New invoice
          </Link>
        </div>
      </div>

      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}

      {rows === null && !error && (
        <Stroke label="Opening the ledger" />
      )}

      {rows && rows.length === 0 && (
        <div className="empty">
          <h2>The ledger is empty</h2>
          <p>
            Invoices you create show up here, and update when PayPal reports a
            payment.
          </p>
          <Link to="/app" className="btn">
            Create the first invoice
          </Link>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid-box">
          <AgGridReact
            ref={gridRef}
            theme={theme}
            rowData={rows}
            columnDefs={narrow ? narrowColumns : wideColumns}
            defaultColDef={{
              sortable: true,
              filter: true,
              resizable: true,
              floatingFilter: true,
              minWidth: 90,
            }}
            getRowId={(p) => p.data.id}
            context={context}
          />
        </div>
      )}

      {/* Invoice preview */}
      {selectedInvoice && (
        <div
          className="scrim"
          role="dialog"
          aria-modal="true"
          aria-label={`Invoice ${selectedInvoice.invoice_number} preview`}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedInvoice(null);
            }
          }}
        >
          <div
            className="dialog"
            style={{
              width: "min(760px, 96vw)",
              maxWidth: "96vw",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div
              className="actions"
              style={{
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0 }}>
                Invoice {selectedInvoice.invoice_number}
              </h2>

              <button
                className="btn quiet small"
                onClick={() => setSelectedInvoice(null)}
                aria-label="Close invoice preview"
              >
                Close ✕
              </button>
            </div>

            <InvoiceSheet
              invoice={selectedInvoice}
              number={selectedInvoice.invoice_number}
            />

            <div
              className="actions"
              style={{ justifyContent: "flex-end", marginTop: 20 }}
            >
              <button
                className="btn quiet"
                onClick={() => setSelectedInvoice(null)}
              >
                Back to ledger
              </button> 
            </div>
          </div>
        </div>
      )}

      {/* Reminder editor */}
      {reminder && (
        <div
          className="scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Review reminder"
        >
          <div className="dialog">
            <h2>{TONES[reminder.tone]} reminder</h2>

            <p className="sub">
              For {reminder.row.client_name}, invoice{" "}
              {reminder.row.invoice_number}, {reminder.row.days_overdue} days
              overdue. Edit anything you like. PayPal adds the pay button.
            </p>

            <div className="field">
              <label htmlFor="rs">Subject</label>
              <input
                id="rs"
                value={reminder.subject}
                onChange={(e) =>
                  setReminder({ ...reminder, subject: e.target.value })
                }
              />
            </div>

            <div className="field">
              <label htmlFor="rb">Message</label>
              <textarea
                id="rb"
                value={reminder.body}
                onChange={(e) =>
                  setReminder({ ...reminder, body: e.target.value })
                }
              />
            </div>

            <div className="actions">
              <button
                className="btn"
                disabled={!!busy}
                onClick={sendReminder}
              >
                Send through PayPal
              </button>

              <button
                className="btn quiet"
                disabled={!!busy}
                onClick={() => setReminder(null)}
              >
                Cancel
              </button>

              {busy === "Sending the reminder" && (
                <Stroke label={busy} />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}