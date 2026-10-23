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

const UNPAID = new Set([
  "SENT",
  "UNPAID",
  "PARTIALLY_PAID",
]);

function normalizeStatus(status) {
  const normalized = String(status || "UNKNOWN").toUpperCase();

  return normalized === "MARKED_AS_PAID"
    ? "PAID"
    : normalized;
}

function isPaid(row) {
  return ["PAID", "COMPLETED"].includes(normalizeStatus(row.status));
}

function isUnpaid(row) {
  return UNPAID.has(normalizeStatus(row.status));
}

function isOverdue(row) {
  return isUnpaid(row) && Number(row.days_overdue || 0) > 0;
}

function amount(row) {
  const value = Number(row.total);

  return Number.isFinite(value) ? value : 0;
}

function currencyOf(row) {
  return String(row.currency || "USD").toUpperCase();
}

function money(value, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || ""} ${Number(value || 0).toFixed(2)}`;
  }
}

function groupedTotals(rows) {
  return rows.reduce((groups, row) => {
    const currency = currencyOf(row);

    groups[currency] =
      (groups[currency] || 0) + amount(row);

    return groups;
  }, {});
}

function formatGroups(groups) {
  const entries = Object.entries(groups || {});

  if (!entries.length) return "—";

  return entries
    .map(([currency, value]) => money(value, currency))
    .join(" · ");
}

function dateValue(value) {
  if (!value) return null;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = dateValue(value);

  if (!date) return "Date unavailable";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
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
    <span
      className="dash-status"
      style={{ color, background }}
    >
      {statusLabel(row)}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  accent,
  icon,
}) {
  return (
    <article
      className="dash-metric"
      style={{ "--metric-accent": accent }}
    >
      <div className="dash-metric-top">
        <span>{label}</span>
        <span className="dash-metric-icon" aria-hidden="true">
          {icon}
        </span>
      </div>

      <div className="dash-metric-value">
        {value}
      </div>

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
      {
        key: "paid",
        label: "Paid",
        color: PALETTE.green,
        matches: (row) => isPaid(row),
      },
      {
        key: "overdue",
        label: "Overdue",
        color: PALETTE.red,
        matches: (row) => isOverdue(row),
      },
      {
        key: "pending",
        label: "Awaiting payment",
        color: PALETTE.blue,
        matches: (row) => isUnpaid(row) && !isOverdue(row),
      },
      {
        key: "draft",
        label: "Draft",
        color: "#a9a49a",
        matches: (row) => normalizeStatus(row.status) === "DRAFT",
      },
    ];

    return definitions.map((definition) => ({
      ...definition,
      count: rows.filter(definition.matches).length,
    }));
  }, [rows]);

  const total = rows.length;

  return (
    <div className="dash-status-chart">
      <div
        className="dash-status-bar"
        role="img"
        aria-label={statuses
          .map((item) => `${item.label}: ${item.count}`)
          .join(", ")}
      >
        {total > 0 ? (
          statuses
            .filter((item) => item.count > 0)
            .map((item) => (
              <div
                key={item.key}
                style={{
                  width: `${(item.count / total) * 100}%`,
                  background: item.color,
                }}
                title={`${item.label}: ${item.count}`}
              />
            ))
        ) : (
          <div style={{ width: "100%", background: "#e6e4dd" }} />
        )}
      </div>

      <div className="dash-status-legend">
        {statuses.map((item) => (
          <div className="dash-legend-item" key={item.key}>
            <span
              className="dash-legend-dot"
              style={{ background: item.color }}
            />

            <span>{item.label}</span>

            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueChart({ rows }) {
  const chart = useMemo(() => {
    const paidRows = rows.filter(isPaid);

    const currencies = [
      ...new Set(paidRows.map(currencyOf)),
    ].sort();

    const groups = {};

    for (const currency of currencies) {
      groups[currency] = Array.from({ length: 6 }, (_, index) => {
        const now = new Date();
        const monthStart = new Date(
          now.getFullYear(),
          now.getMonth() - 5 + index,
          1
        );

        const nextMonth = new Date(
          monthStart.getFullYear(),
          monthStart.getMonth() + 1,
          1
        );

        const total = paidRows
          .filter((row) => {
            if (currencyOf(row) !== currency) return false;

            // Prefer a payment timestamp when available.
            // Otherwise use updated_at as an approximation.
            const timestamp =
              row.paid_at ||
              row.payment_date ||
              row.updated_at;

            const date = dateValue(timestamp);

            return (
              date &&
              date >= monthStart &&
              date < nextMonth
            );
          })
          .reduce((sum, row) => sum + amount(row), 0);

        return {
          key: `${monthStart.getFullYear()}-${monthStart.getMonth()}`,
          label: new Intl.DateTimeFormat("en", {
            month: "short",
          }).format(monthStart),
          value: total,
        };
      });
    }

    return { currencies, groups };
  }, [rows]);

  const hasTimestamps = rows.some(
    (row) =>
      row.paid_at ||
      row.payment_date ||
      row.updated_at
  );

  return (
    <div>
      {!chart.currencies.length ? (
        <EmptyState>
          Paid invoices will appear here when available.
        </EmptyState>
      ) : (
        <>
          {!hasTimestamps && (
            <p className="dash-chart-note">
              Payment dates are not available in your invoice records yet.
            </p>
          )}

          {chart.currencies.map((currency) => {
            const months = chart.groups[currency] || [];

            const max = Math.max(
              ...months.map((month) => month.value),
              1
            );

            return (
              <div
                className="dash-revenue-group"
                key={currency}
              >
                <div className="dash-revenue-heading">
                  <strong>{currency}</strong>
                  <span>
                    {money(
                      months.reduce(
                        (sum, month) => sum + month.value,
                        0
                      ),
                      currency
                    )}
                  </span>
                </div>

                <div className="dash-bars">
                  {months.map((month) => (
                    <div
                      className="dash-bar-column"
                      key={month.key}
                    >
                      <span className="dash-bar-value">
                        {month.value
                          ? new Intl.NumberFormat("en", {
                              notation: "compact",
                              maximumFractionDigits: 1,
                            }).format(month.value)
                          : "—"}
                      </span>

                      <div className="dash-bar-track">
                        <div
                          className="dash-bar"
                          style={{
                            height: `${Math.max(
                              month.value > 0
                                ? (month.value / max) * 100
                                : 0,
                              month.value > 0 ? 5 : 0
                            )}%`,
                          }}
                          title={money(month.value, currency)}
                        />
                      </div>

                      <span className="dash-bar-label">
                        {month.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <p className="dash-chart-note">
            Historical collections are approximate when a payment timestamp
            is unavailable. Invoice creation dates are not treated as payment
            dates.
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
        const aDate = dateValue(
          a.updated_at || a.created_at
        )?.getTime() || 0;

        const bDate = dateValue(
          b.updated_at || b.created_at
        )?.getTime() || 0;

        return bDate - aDate;
      })
      .slice(0, 6);
  }, [rows]);

  if (!recent.length) {
    return (
      <EmptyState>
        Your recent invoices will appear here.
      </EmptyState>
    );
  }

  return (
    <div className="dash-recent-list">
      {recent.map((row, index) => (
        <div
          className="dash-recent-row"
          key={row.id || row.invoice_number || index}
        >
          <div className="dash-recent-main">
            <div className="dash-recent-number">
              {row.invoice_number || "Invoice"}
            </div>

            <div className="dash-recent-client">
              {row.client_name || "Unnamed client"}
            </div>

            <div className="dash-recent-date">
              {formatDate(row.updated_at || row.created_at)}
            </div>
          </div>

          <div className="dash-recent-side">
            <strong>
              {money(amount(row), currencyOf(row))}
            </strong>

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

      if (!Array.isArray(response)) {
        throw new Error("The invoice API returned an unexpected response.");
      }

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

    const timer = setInterval(() => {
      load();
    }, 15000);

    return () => clearInterval(timer);
  }, [load]);

  const stats = useMemo(() => {
    if (!rows) return null;

    const paid = rows.filter(isPaid);
    const unpaid = rows.filter(isUnpaid);
    const overdue = rows.filter(isOverdue);

    const invoiced = groupedTotals(
      rows.filter((row) => normalizeStatus(row.status) !== "DRAFT")
    );

    const collected = groupedTotals(paid);
    const outstanding = groupedTotals(unpaid);
    const overdueTotal = groupedTotals(overdue);

    const currencyCount = new Set(
      rows.map(currencyOf)
    ).size;

    return {
      invoiced,
      collected,
      outstanding,
      overdueTotal,
      invoiceCount: rows.length,
      paidCount: paid.length,
      unpaidCount: unpaid.length,
      overdueCount: overdue.length,
      draftCount: rows.filter(
        (row) => normalizeStatus(row.status) === "DRAFT"
      ).length,
      currencyCount,
    };
  }, [rows]);

  return (
    <main className="wrap page dash-page">
      <section className="dash-welcome">
        <div>
          <p className="dash-eyebrow">YOUR BUSINESS AT A GLANCE</p>

          <h1>Dashboard<span>.</span></h1>

          <p className="dash-intro">
            A clearer view of your invoices, collections, and outstanding payments.
          </p>
        </div>

        <div className="dash-header-actions">
          <button
            className="btn quiet small"
            onClick={() => load(true)}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>

          <Link to="/app" className="btn small">
            + New invoice
          </Link>
        </div>
      </section>

      {error && (
        <div className="err" role="alert">
          {error}

          <button
            className="btn quiet small"
            onClick={() => load(true)}
            style={{ marginLeft: 12 }}
          >
            Try again
          </button>
        </div>
      )}

      {rows === null && !error && (
        <Stroke label="Loading your financial overview" />
      )}

      {stats && (
        <>
          <section className="dash-metrics" aria-label="Financial overview">
            <MetricCard
              label="Total invoiced"
              value={formatGroups(stats.invoiced)}
              detail={`${stats.invoiceCount - stats.draftCount} issued invoices`}
              accent={PALETTE.blue}
              icon="↗"
            />

            <MetricCard
              label="Collected"
              value={formatGroups(stats.collected)}
              detail={`${stats.paidCount} paid invoices`}
              accent={PALETTE.green}
              icon="✓"
            />

            <MetricCard
              label="Outstanding"
              value={formatGroups(stats.outstanding)}
              detail={`${stats.unpaidCount} unpaid invoices`}
              accent={PALETTE.amber}
              icon="◷"
            />

            <MetricCard
              label="Overdue"
              value={formatGroups(stats.overdueTotal)}
              detail={`${stats.overdueCount} overdue invoices`}
              accent={PALETTE.red}
              icon="!"
            />
          </section>

          {stats.currencyCount > 1 && (
            <p className="dash-chart-note">
              Totals are grouped by currency. Different currencies are never
              added together.
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

                <span className="dash-total-count">
                  {stats.invoiceCount}
                </span>
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
                <p className="dash-muted">
                  Based on the available invoice timestamps.
                </p>
              </div>

              <Link to="/app/ledger" className="btn quiet small">
                View ledger →
              </Link>
            </div>

            <RecentInvoices rows={rows} />
          </section>

          <section className="dash-bottom-cta">
            <div>
              <p className="dash-eyebrow">MAKE BETTER DECISIONS</p>
              <h2>Know what needs your attention.</h2>
              <p>
                Get payment priorities and practical recommendations based on
                your invoice data.
              </p>
            </div>

            <Link to="/app/insights" className="btn">
              Explore AI Insights →
            </Link>
          </section>

          <p className="dash-updated">
            {lastUpdated
              ? `Last updated at ${lastUpdated.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}`
              : ""}
            {" · "}
            Refreshes automatically every 15 seconds.
          </p>
        </>
      )}
    </main>
  );
}
