import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "./nav.jsx";
import { Stroke } from "./ui.jsx";
import { api } from "./lib.js";

const PALETTE = {
  red: "#962421",
  green: "#2f6b3f",
  blue: "#315b9a",
  amber: "#a66b19",
  muted: "#6a665e",
  rule: "#e6e4dd",
  paper: "#fafaf6",
  white: "#fffffe",
};

const UNPAID = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);

function normalizeStatus(status) {
  const norm = String(status || "UNKNOWN").toUpperCase();
  return norm === "MARKED_AS_PAID" ? "PAID" : norm;
}

const isPaid = (row) => ["PAID", "COMPLETED"].includes(normalizeStatus(row.status));
const isUnpaid = (row) => UNPAID.has(normalizeStatus(row.status));
const isOverdue = (row) => isUnpaid(row) && Number(row.days_overdue || 0) > 0;
const amount = (row) => { const v = Number(row.total); return Number.isFinite(v) ? v : 0; };
const currencyOf = (row) => String(row.currency || "USD").toUpperCase();

function money(val, curr) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr || "USD",
      maximumFractionDigits: 2,
    }).format(val);
  } catch {
    return `${curr || ""} ${Number(val || 0).toFixed(2)}`;
  }
}

function groupedTotals(rows) {
  return rows.reduce((groups, row) => {
    const curr = currencyOf(row);
    groups[curr] = (groups[curr] || 0) + amount(row);
    return groups;
  }, {});
}

function formatGroups(groups) {
  const entries = Object.entries(groups || {});
  if (!entries.length) return "—";
  return entries.map(([curr, val]) => money(val, curr)).join(" · ");
}

function dateValue(val) {
  if (!val) return null;
  const p = new Date(val);
  return Number.isNaN(p.getTime()) ? null : p;
}

function formatDate(val) {
  const d = dateValue(val);
  if (!d) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function statusLabel(row) {
  if (isOverdue(row)) return "Overdue";
  const status = normalizeStatus(row.status);
  const labels = {
    PAID: "Paid",
    COMPLETED: "Paid",
    DRAFT: "Draft",
    SENT: "Awaiting payment",
    UNPAID: "Awaiting payment",
    PARTIALLY_PAID: "Partially paid",
  };
  return labels[status] || status.replaceAll("_", " ");
}

function StatusBadge({ row }) {
  let color = PALETTE.muted;
  let background = "#f0eee8";
  if (isOverdue(row)) {
    color = PALETTE.red;
    background = "#fce7e5";
  } else if (isPaid(row)) {
    color = PALETTE.green;
    background = "#ddf5e7";
  } else if (isUnpaid(row)) {
    color = PALETTE.blue;
    background = "#e5eeff";
  }
  return (
    <span className="dash-status" style={{ color, background }}>
      {statusLabel(row)}
    </span>
  );
}

function MetricCard({ label, value, detail, accent, icon }) {
  return (
    <article className="dash-metric" style={{ "--metric-accent": accent }}>
      <div className="dash-metric-top">
        <span>{label}</span>
        <span className="dash-metric-icon" aria-hidden="true">{icon}</span>
      </div>
      <div className="dash-metric-value">{value}</div>
      <p>{detail}</p>
    </article>
  );
}

function EmptyState({ children }) {
  return (
    <div className="dash-empty">
      <span aria-hidden="true">◇</span>
      <p>{children}</p>
    </div>
  );
}

function InvoiceStatusChart({ rows }) {
  const statuses = useMemo(() => {
    const definitions = [
      { key: "paid", label: "Paid", color: PALETTE.green, matches: (r) => isPaid(r) },
      { key: "overdue", label: "Overdue", color: PALETTE.red, matches: (r) => isOverdue(r) },
      { key: "pending", label: "Awaiting payment", color: PALETTE.blue, matches: (r) => isUnpaid(r) && !isOverdue(r) },
      { key: "draft", label: "Draft", color: "#a9a49a", matches: (r) => normalizeStatus(r.status) === "DRAFT" },
    ];
    return definitions.map((def) => ({ ...def, count: rows.filter(def.matches).length }));
  }, [rows]);

  const total = rows.length;
  const paidCount = statuses.find((s) => s.key === "paid")?.count || 0;
  const efficiency = total > 0 ? Math.round((paidCount / total) * 100) : 0;

  return (
    <div className="dash-status-chart">
      <div className="dash-donut-wrap">
        <svg className="dash-donut-svg" viewBox="0 0 100 100" width="100" height="100" aria-label={`Collection efficiency ${efficiency}%`}>
          <circle cx="50" cy="50" r="38" fill="transparent" stroke="var(--rule)" strokeWidth="9" />
          <circle
            cx="50" cy="50" r="38" fill="transparent" stroke={PALETTE.green} strokeWidth="9"
            strokeDasharray={238.76} strokeDashoffset={238.76 * (1 - efficiency / 100)}
            strokeLinecap="round" transform="rotate(-90 50 50)"
          />
          <text x="50" y="47" textAnchor="middle" dominantBaseline="central" fontSize="18" fontWeight="700" fill="var(--ink)" fontFamily="var(--sans)">
            {efficiency}%
          </text>
          <text x="50" y="64" textAnchor="middle" dominantBaseline="central" fontSize="9" fontWeight="600" fill="var(--muted)" fontFamily="var(--sans)">
            COLLECTED
          </text>
        </svg>

        <div className="dash-donut-details">
          <div className="dash-status-bar" role="img" aria-label={statuses.map((s) => `${s.label}: ${s.count}`).join(", ")}>
            {total > 0 ? (
              statuses.filter((s) => s.count > 0).map((s) => (
                <div key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
              ))
            ) : (
              <div style={{ width: "100%", background: "#e6e4dd" }} />
            )}
          </div>
          <div className="dash-status-legend">
            {statuses.map((s) => (
              <div className="dash-legend-item" key={s.key}>
                <span className="dash-legend-dot" style={{ background: s.color }} />
                <span>{s.label}</span>
                <strong>{s.count}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RevenueChart({ rows }) {
  const chart = useMemo(() => {
    const paidRows = rows.filter(isPaid);
    const currencies = [...new Set(paidRows.map(currencyOf))].sort();
    const groups = {};

    for (const currency of currencies) {
      groups[currency] = Array.from({ length: 6 }, (_, index) => {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
        const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        const total = paidRows
          .filter((row) => {
            if (currencyOf(row) !== currency) return false;
            const date = dateValue(row.paid_at || row.payment_date || row.updated_at);
            return date && date >= monthStart && date < nextMonth;
          })
          .reduce((sum, row) => sum + amount(row), 0);

        return {
          key: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
          label: new Intl.DateTimeFormat("en", { month: "short" }).format(monthStart),
          value: total,
        };
      });
    }
    return { currencies, groups };
  }, [rows]);

  const hasTimestamps = rows.some((r) => r.paid_at || r.payment_date || r.updated_at);

  return (
    <div>
      {!chart.currencies.length ? (
        <EmptyState>Paid invoices will appear here when available.</EmptyState>
      ) : (
        <>
          {!hasTimestamps && (
            <p className="dash-chart-note">Payment dates are not available in your invoice records yet.</p>
          )}
          {chart.currencies.map((curr) => {
            const months = chart.groups[curr] || [];
            const max = Math.max(...months.map((m) => m.value), 1);
            return (
              <div className="dash-revenue-group" key={curr}>
                <div className="dash-revenue-heading">
                  <strong>{curr}</strong>
                  <span>{money(months.reduce((sum, m) => sum + m.value, 0), curr)}</span>
                </div>
                <div className="dash-bars">
                  {months.map((m) => (
                    <div className="dash-bar-column" key={m.key}>
                      <span className="dash-bar-value">
                        {m.value ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(m.value) : "—"}
                      </span>
                      <div className="dash-bar-track">
                        <div
                          className="dash-bar"
                          style={{ height: `${Math.max(m.value > 0 ? (m.value / max) * 100 : 0, m.value > 0 ? 5 : 0)}%` }}
                          title={money(m.value, curr)}
                        />
                      </div>
                      <span className="dash-bar-label">{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="dash-chart-note">
            Historical collections are approximate when a payment timestamp is unavailable.
          </p>
        </>
      )}
    </div>
  );
}

function RecentInvoices({ rows }) {
  const recent = useMemo(() => {
    return [...rows]
      .sort((a, b) => {
        const aDate = dateValue(a.updated_at || a.created_at)?.getTime() || 0;
        const bDate = dateValue(b.updated_at || b.created_at)?.getTime() || 0;
        return bDate - aDate;
      })
      .slice(0, 6);
  }, [rows]);

  if (!recent.length) {
    return <EmptyState>Your recent invoices will appear here.</EmptyState>;
  }

  return (
    <div className="dash-recent-list">
      {recent.map((row, index) => (
        <div className="dash-recent-row" key={row.id || row.invoice_number || index}>
          <div className="dash-recent-main">
            <div className="dash-recent-number">{row.invoice_number || "Invoice"}</div>
            <div className="dash-recent-client">{row.client_name || "Unnamed client"}</div>
            <div className="dash-recent-date">{formatDate(row.updated_at || row.created_at)}</div>
          </div>
          <div className="dash-recent-side">
            <strong>{money(amount(row), currencyOf(row))}</strong>
            <StatusBadge row={row} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const response = await api("/api/invoices");
      if (!Array.isArray(response)) throw new Error("The invoice API returned an unexpected response.");
      setRows(response);
      setError("");
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || "Unable to load invoices.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 15000);
    return () => clearInterval(timer);
  }, [load]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const paid = rows.filter(isPaid);
    const unpaid = rows.filter(isUnpaid);
    const overdue = rows.filter(isOverdue);
    const invoiced = groupedTotals(rows.filter((r) => normalizeStatus(r.status) !== "DRAFT"));

    return {
      invoiced,
      collected: groupedTotals(paid),
      outstanding: groupedTotals(unpaid),
      overdueTotal: groupedTotals(overdue),
      invoiceCount: rows.length,
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      overdueCount: overdue.length,
      draftCount: rows.filter((r) => normalizeStatus(r.status) === "DRAFT").length,
      currencyCount: new Set(rows.map(currencyOf)).size,
    };
  }, [rows]);

  return (
    <main className="wrap page dash-page">
      <section className="dash-welcome">
        <div>
          <p className="dash-eyebrow">YOUR BUSINESS AT A GLANCE</p>
          <h1>Dashboard<span>.</span></h1>
          <p className="dash-intro">A clearer view of your invoices, collections, and outstanding payments.</p>
        </div>
        <div className="dash-header-actions">
          <button className="btn quiet small" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
          <Link to="/app" className="btn small">+ New invoice</Link>
        </div>
      </section>

      {error && (
        <div className="err" role="alert">
          {error}
          <button className="btn quiet small" onClick={() => load(true)} style={{ marginLeft: 12 }}>
            Try again
          </button>
        </div>
      )}

      {rows === null && !error && <Stroke label="Loading your financial overview" />}

      {stats && (
        <>
          <section className="dash-metrics" aria-label="Financial overview">
            <MetricCard
              label="Total invoiced" value={formatGroups(stats.invoiced)}
              detail={`${stats.invoiceCount - stats.draftCount} issued invoices`}
              accent={PALETTE.blue} icon="↗"
            />
            <MetricCard
              label="Collected" value={formatGroups(stats.collected)}
              detail={`${stats.paidCount} paid invoices`}
              accent={PALETTE.green} icon="✓"
            />
            <MetricCard
              label="Outstanding" value={formatGroups(stats.outstanding)}
              detail={`${stats.unpaidCount} unpaid invoices`}
              accent={PALETTE.amber} icon="◷"
            />
            <MetricCard
              label="Overdue" value={formatGroups(stats.overdueTotal)}
              detail={`${stats.overdueCount} overdue invoices`}
              accent={PALETTE.red} icon="!"
            />
          </section>

          {stats.currencyCount > 1 && (
            <p className="dash-chart-note">
              Totals are grouped by currency. Different currencies are never added together.
            </p>
          )}

          <section className="dash-content-grid">
            <article className="dash-card dash-revenue-card">
              <div className="dash-card-heading">
                <div>
                  <p className="dash-eyebrow">COLLECTIONS</p>
                  <h2>Revenue overview</h2>
                </div>
                <span className="dash-card-symbol">↗</span>
              </div>
              <RevenueChart rows={rows} />
            </article>

            <article className="dash-card">
              <div className="dash-card-heading">
                <div>
                  <p className="dash-eyebrow">YOUR PIPELINE</p>
                  <h2>Invoice status</h2>
                </div>
                <span className="dash-total-count">{stats.invoiceCount}</span>
              </div>
              <InvoiceStatusChart rows={rows} />
              <div className="dash-status-footer">
                <span>Drafts awaiting completion</span>
                <strong>{stats.draftCount}</strong>
              </div>
            </article>
          </section>

          <section className="dash-card dash-recent-card">
            <div className="dash-card-heading">
              <div>
                <p className="dash-eyebrow">LATEST RECORDS</p>
                <h2>Recent invoices</h2>
                <p className="dash-muted">Based on the available invoice timestamps.</p>
              </div>
              <Link to="/app/ledger" className="btn quiet small">View ledger →</Link>
            </div>
            <RecentInvoices rows={rows} />
          </section>

          <section className="dash-bottom-cta">
            <div>
              <p className="dash-eyebrow">MAKE BETTER DECISIONS</p>
              <h2>Know what needs your attention.</h2>
              <p>Get payment priorities and practical recommendations based on your invoice data.</p>
            </div>
            <Link to="/app/insights" className="btn">Explore AI Insights →</Link>
          </section>

          <p className="dash-updated">
            {lastUpdated ? `Last updated at ${lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
            {" · "}Refreshes automatically every 15 seconds.
          </p>
        </>
      )}
    </main>
  );
}
