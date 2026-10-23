import { longDate, lineAmount, money, totals } from "./lib.js";

export function Mark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="3" fill="#962421" />
      <rect x="7" y="6" width="2" height="20" fill="#FAFAF6" />
      <rect x="12" y="9" width="13" height="2" fill="#FAFAF6" />
      <rect x="12" y="15" width="13" height="2" fill="#FAFAF6" />
      <rect x="12" y="21" width="8" height="2" fill="#FAFAF6" />
    </svg>
  );
}

export function Stroke({ label }) {
  return (
    <div className="busy" role="status">
      <svg className="stroke" viewBox="0 0 150 24" aria-hidden="true">
        <path
          pathLength="100"
          d="M2 12 C 14 2, 24 22, 36 12 S 58 2, 70 12 S 92 22, 104 12 S 126 2, 138 12 S 146 18, 148 12"
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

const today = () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function InvoiceSheet({ invoice, number }) {
  const { client_name, client_email, currency = "USD", tax_name = "GST", items, due_date, notes } = invoice;
  const shown = items.filter((i) => i.name || Number(i.unit_price));
  const sum = totals(shown);
  const fmt = (n) => money(n, currency);

  return (
    <article className="sheet" aria-label="Invoice preview">
      <header className="s-head">
        <div>
          <div className="s-title">Invoice</div>
          <div className="s-num">No. {number || "assigned by PayPal"}</div>
        </div>
        <div className="s-dates">
          <div>Issued <b>{today()}</b></div>
          <div>Due <b>{longDate(due_date) || "not set"}</b></div>
        </div>
      </header>

      <section className="s-bill">
        <div className="s-label">Billed to</div>
        <div className={client_name ? "s-name" : "s-name ghost"}>{client_name || "Client name"}</div>
        <div className={client_email ? "s-mail" : "s-mail ghost"}>{client_email || "client@email.com"}</div>
      </section>

      <div className="s-grid" role="table" aria-label="Line items">
        <div className="s-th">Item</div>
        <div className="s-th num">Qty</div>
        <div className="s-th num">Rate</div>
        <div className="s-th num tx">{tax_name}</div>
        <div className="s-th num amt">Amount</div>
        {shown.map((i, n) => (
          <div className="rowin" key={n} style={{ "--d": `${Math.min(n, 6) * 45}ms` }}>
            <div className="s-td">{i.name || <span className="ghost">Untitled line</span>}</div>
            <div className="s-td num">{Number(i.quantity) || 0}</div>
            <div className="s-td num">{fmt(Number(i.unit_price) || 0)}</div>
            <div className="s-td num tx">{Number(i.tax_rate) ? `${Number(i.tax_rate)}%` : ""}</div>
            <div className="s-td num amt">{fmt(lineAmount(i))}</div>
          </div>
        ))}
        {shown.length === 0 &&
          [0, 1].map((n) => (
            <div className="rowin" key={n}>
              <div className="s-td ghost">{n === 0 ? "Your line items appear here" : ""}</div>
              <div className="s-td" />
              <div className="s-td" />
              <div className="s-td tx" />
              <div className="s-td amt" />
            </div>
          ))}
      </div>

      <div className="s-sum">
        <div className="muted"><span>Subtotal</span><span>{fmt(sum.sub)}</span></div>
        {Object.entries(sum.byRate).map(([rate, cents]) => (
          <div className="muted" key={rate}>
            <span>{tax_name} {rate}%</span>
            <span>{fmt(cents / 100)}</span>
          </div>
        ))}
        <div className="s-total"><span>Total due</span><span>{fmt(sum.total)}</span></div>
      </div>

      {notes && <div className="s-note">{notes}</div>}
      <footer className="s-foot">Payable online through PayPal.</footer>
    </article>
  );
}
