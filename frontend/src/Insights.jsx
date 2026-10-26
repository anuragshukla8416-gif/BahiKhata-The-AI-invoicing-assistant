import { useCallback, useEffect, useState } from "react";
import { api } from "./lib.js";

function money(amount, currency) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toLocaleString("en-IN")}`;
  }
}

function AmountGroups({ title, values, emptyText }) {
  const entries = Object.entries(values || {});

  return (
    <section className="insight-card">
      <h2>{title}</h2>

      {entries.length ? (
        <div className="insight-amounts">
          {entries.map(([currency, amount]) => (
            <div className="insight-amount-row" key={currency}>
              <span>{currency}</span>
              <strong>{money(amount, currency)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="insight-muted">{emptyText}</p>
      )}
    </section>
  );
}

function CashflowCard({ title, values }) {
  const entries = Object.entries(values || {});

  return (
    <section className="insight-card">
      <h2>{title}</h2>

      {entries.length ? (
        <div className="insight-amounts">
          {entries.map(([currency, amount]) => (
            <div className="insight-amount-row" key={currency}>
              <span>{currency}</span>
              <strong>{money(amount, currency)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="insight-muted">No unpaid invoices are due in this period.</p>
      )}
    </section>
  );
}

export default function Insights() {
  const [data, setData] = useState(null);
  const [cashflow, setCashflow] = useState(null);

  const [loading, setLoading] = useState(true);
  const [cashflowLoading, setCashflowLoading] = useState(true);

  const [error, setError] = useState("");
  const [cashflowError, setCashflowError] = useState("");

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await api("/api/insights");
      setData(res);
    } catch (err) {
      setError(err.message || "Could not load financial insights.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCashflow = useCallback(async () => {
    setCashflowLoading(true);
    setCashflowError("");

    try {
      const res = await api("/api/cashflow");
      setCashflow(res);
    } catch (err) {
      setCashflowError(err.message || "Could not load the cash-flow outlook.");
    } finally {
      setCashflowLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadInsights();
    loadCashflow();
  }, [loadInsights, loadCashflow]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return (
    <main className="wrap page insights-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">FINANCIAL INTELLIGENCE</div>
          <h1>Your finances, at a glance.</h1>
          <p>
            See what is unpaid, what is coming due, and which invoices may need your attention.
          </p>
        </div>

        <button
          className="btn quiet"
          onClick={refreshAll}
          disabled={loading || cashflowLoading}
        >
          {loading || cashflowLoading ? "Refreshing insights..." : "Refresh insights"}
        </button>
      </div>

      {error && <div className="err">{error}</div>}

      {/* CASH-FLOW FORECAST */}
      <section className="insight-card">
        <div className="insight-section-head">
          <div>
            <div className="eyebrow">PLAN AHEAD</div>
            <h2>Expected cash flow</h2>
            <p className="insight-muted">
              Unpaid invoice totals grouped by the time they are due.
            </p>
          </div>

          {cashflow?.as_of && (
            <span className="tag">Updated {cashflow.as_of}</span>
          )}
        </div>

        {cashflowError && (
          <div className="err">
            {cashflowError}
            <button
              className="btn text"
              onClick={loadCashflow}
              disabled={cashflowLoading}
            >
              Retry
            </button>
          </div>
        )}

        {cashflowLoading && !cashflow ? (
          <p className="insight-muted">Loading your cash-flow outlook…</p>
        ) : cashflow ? (
          <>
            <div className="insight-summary">
              <CashflowCard
                title="Due in 7 days"
                values={cashflow.expected_by_due_date?.next_7_days}
              />

              <CashflowCard
                title="Due in 30 days"
                values={cashflow.expected_by_due_date?.next_30_days}
              />

              <CashflowCard
                title="Due in 90 days"
                values={cashflow.expected_by_due_date?.next_90_days}
              />
            </div>

            <div className="insight-summary">
              <AmountGroups
                title="Past due"
                values={cashflow.already_overdue}
                emptyText="No invoices are past due."
              />

              <AmountGroups
                title="All unpaid invoices"
                values={cashflow.total_unpaid_by_currency}
                emptyText="There are no unpaid invoices."
              />
            </div>

            <p className="insight-disclaimer">
              {cashflow.basis ||
                "Estimates are based on unpaid invoice totals and due dates."}
              {" "}These figures are estimates, not guarantees that payments will arrive.
              Partial payments may not be fully reflected.
            </p>
          </>
        ) : null}
      </section>

      {/* EXISTING FINANCIAL SUMMARY */}
      {loading && !data ? (
        <div className="empty">
          <h2>Reviewing your invoice data</h2>
          <p>Preparing your balances, due dates, and collection priorities…</p>
        </div>
      ) : data ? (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">INVOICE OVERVIEW</div>
              <h1>Your invoice position</h1>
            </div>
          </div>

          <div className="insight-summary">
            <AmountGroups
              title="Outstanding balance"
              values={data.outstanding_by_currency}
              emptyText="You have no outstanding invoices."
            />

            <AmountGroups
              title="Overdue balance"
              values={data.overdue_by_currency}
              emptyText="You have no overdue balances."
            />

            <AmountGroups
              title="Due in the next 7 days"
              values={data.upcoming_7_days_by_currency}
              emptyText="No invoices are due in the next 7 days."
            />
          </div>

          {/* OVERDUE PRIORITIES */}
          <section className="insight-card insight-priorities">
            <div className="insight-section-head">
              <div>
                <h2>Invoices to follow up</h2>
                <p className="insight-muted">
                  {data.overdue_count} overdue invoice
                  {data.overdue_count === 1 ? "" : "s"} need{data.overdue_count === 1 ? "s" : ""} review
                </p>
              </div>

              <a className="btn small" href="/app/ledger">
                View all invoices
              </a>
            </div>

            {data.top_chase_candidates?.length ? (
              <div className="insight-table-wrap">
                <table className="insight-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Amount</th>
                      <th>Overdue by</th>
                      <th>Reminders</th>
                      <th>Priority reason</th>
                    </tr>
                  </thead>

                  <tbody>
                    {data.top_chase_candidates.map((item) => (
                      <tr key={item.invoice_id || item.invoice_number}>
                        <td>{item.invoice_number}</td>
                        <td>{item.client_name}</td>
                        <td>{money(item.amount, item.currency)}</td>
                        <td>
                          <span className="tag late">
                            {item.days_overdue} days
                          </span>
                        </td>
                        <td>{item.reminders_sent ?? 0}</td>
                        <td>
                          {item.priority_reason || "Check the invoice and decide whether to send a reminder."}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="insight-muted">
                No overdue invoices need follow-up right now.
              </p>
            )}
          </section>

          {/* GEMINI RECOMMENDATIONS */}
          <section className="insight-card">
            <div className="insight-section-head">
              <div>
                <h2>Recommended next steps</h2>
                <p className="insight-muted">
                  Actionable suggestions to help you follow up on invoices and plan cash flow.
                </p>
              </div>

              <span className="tag">
                {data.ai_available ? "AI ANALYSIS" : "BASIC GUIDANCE"}
              </span>
            </div>

            {data.insights?.length ? (
              <ol className="insight-recommendations">
                {data.insights.map((item, index) => (
                  <li key={`${index}-${typeof item === 'string' ? item : index}`}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
                ))}
              </ol>
            ) : (
              <p className="insight-muted">
                There are no recommendations to show right now. Refresh to try again.
              </p>
            )}

            {!data.ai_available && (
              <p className="hint">
                Gemini analysis is currently unavailable, so these suggestions are standard guidance rather than AI-generated recommendations.
              </p>
            )}
          </section>

          <p className="insight-disclaimer">
            Figures are calculated from the invoice records available to the app. If partial payments have not been recorded in the backend, outstanding balances may be higher than the amount still owed.
          </p>
        </>
      ) : null}
    </main>
  );
}