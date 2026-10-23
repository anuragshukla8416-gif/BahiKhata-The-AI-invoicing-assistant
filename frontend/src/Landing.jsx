import { Link } from "./nav.jsx";
import { InvoiceSheet } from "./ui.jsx";

const inDays = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const sample = {
  client_name: "Studio Kora",
  client_email: "accounts@studiokora.example",
  currency: "INR",
  tax_name: "GST",
  due_date: inDays(15),
  notes: "Thank you for your business.",
  items: [
    { name: "Brand identity design", quantity: 3, unit_price: 8000, tax_rate: 18 },
    { name: "Print-ready files", quantity: 1, unit_price: 2500, tax_rate: 18 },
  ],
};

const steps = [
  {
    n: "01",
    title: "Describe the work",
    body: "Enter your client details, services, rates, taxes and payment terms in your own words. BahiKhata turns your notes into a structured invoice for you to review.",
  },
  {
    n: "02",
    title: "Review and send",
    body: "Check the client details, line items and totals in the invoice preview. Make any necessary changes, then create and send your invoice through PayPal.",
  },
  {
    n: "03",
    title: "Stay on top of payments",
    body: "Track invoice status from your ledger. When a payment becomes overdue, prepare a tailored reminder and follow up without losing track of outstanding balances.",
  },
];

const details = [
  [
    "Flexible tax handling",
    "Set tax rates on individual invoice items and choose the applicable tax type. Review the final invoice total before sending.",
  ],
  [
    "Thoughtful payment reminders",
    "Prepare reminders with a tone suited to how late a payment is, helping you follow up professionally while maintaining client relationships.",
  ],
  [
    "Controlled follow-ups",
    "Configure reminder frequency and limits to avoid unnecessary messages. Paid invoices should no longer receive payment reminders.",
  ],
  [
    "Review before sending",
    "Review extracted invoice details and generated reminder messages before they are sent. Automatic follow-ups can be enabled separately.",
  ],
  [
    "Payments through PayPal",
    "Clients complete payment through PayPal. BahiKhata helps you manage invoice information and track payment updates without handling client funds directly.",
  ],
];

export default function Landing() {
  return (
    <main>
      <div className="wrap">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Invoicing &amp; payment follow-ups</p>

            
            <h1 className="hero-title">
              Generate it. Send it. Get paid.
            </h1>

            <img
              src="/logo.jpg"
              alt="BahiKhata"
              className="hero-brand-logo"
            />

            <p className="lede">
              Less time on invoices. More time for your business.
              Turn client notes into invoices, send them through PayPal,
              and stay on top of payment follow-ups.
            </p>

            <div className="actions">
              <Link to="/app" className="btn">
                Create an invoice
              </Link>
              <a href="#how" className="btn quiet">
                Explore how it works
              </a>
            </div>

            <p className="fine">
              <span className="environment-dot" aria-hidden="true" />
              Sandbox environment · Payments are simulated
            </p>
          </div>

          <div className="hero-preview">
            <InvoiceSheet invoice={sample} />
            <p className="caption">
              Invoice preview · See how your invoice takes shape
            </p>
          </div>
        </section>
      </div>

      <section className="section" id="how">
        <div className="wrap">
          <p className="eyebrow">A simpler workflow</p>
          <h2>From client notes to payment follow-ups</h2>

          <div className="steps">
            {steps.map((step) => (
              <article key={step.n}>
                <i>{step.n}</i>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="details">
        <div className="wrap">
          <p className="eyebrow">Built for everyday business</p>
          <h2>The details that keep your finances organised</h2>

          <div>
            {details.map(([title, body]) => (
              <div className="dl-row" key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap brand-sec">
          <div>
            <p className="eyebrow">Our philosophy</p>
            <h2>Rooted in the tradition of the bahi-khata</h2>

            <p>
              For generations, Indian shopkeepers have recorded sales,
              outstanding balances and payments in a bahi-khata — a trusted
              ledger for keeping business accounts in order.
            </p>

            <p>
              BahiKhata brings that spirit of careful bookkeeping into a
              digital workflow for freelancers and small businesses, combining
              familiar accounting principles with AI-assisted invoicing.
            </p>
          </div>

          <img
            src="/logo.jpg"
            alt="BahiKhata brand identity"
            width="1100"
            height="615"
            loading="lazy"
          />
        </div>
      </section>

      <section className="cta">
        <div className="wrap">
          <p className="eyebrow">Make invoicing simpler</p>
          <h2>Keep your invoices organised and your follow-ups on track.</h2>
          <Link to="/app" className="btn">
            Open BahiKhata
          </Link>
          <p className="fine">
            Sandbox environment · Payments are simulated
          </p>
        </div>
      </section>
    </main>
  );
}