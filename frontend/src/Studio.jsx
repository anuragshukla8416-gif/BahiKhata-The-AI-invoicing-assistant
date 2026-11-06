import { useRef, useState } from "react";
import { Link } from "./nav.jsx";
import { InvoiceSheet, Stroke } from "./ui.jsx";
import { api, convertPrice, totals } from "./lib.js";

const CURRENCIES = ["USD", "INR", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"];
const blankItem = () => ({ name: "", quantity: "1", unit_price: "", tax_rate: "0" });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const blank = () => ({
  client_name: "",
  client_email: "",
  currency: "INR",
  tax_name: "GST",
  items: [blankItem()],
  due_date: inDays(15),
  notes: "",
});

const str = (v) => (v === null || v === undefined ? "" : String(v));

function fromParsed(p, current) {
  const items = (p.items || []).map((i) => ({
    name: str(i.name),
    quantity: str(i.quantity ?? 1),
    unit_price: str(i.unit_price),
    tax_rate: str(i.tax_rate ?? 0),
  }));
  return {
    client_name: str(p.client_name),
    client_email: str(p.client_email),
    currency: p.currency || current.currency,
    tax_name: p.tax_name || current.tax_name,
    items: items.length ? items : [blankItem()],
    due_date: p.due_date || current.due_date,
    notes: str(p.notes),
  };
}

function missingFrom(p) {
  const out = [];
  if (!p.client_name) out.push("client name");
  if (!p.client_email) out.push("client email");
  if (!(p.items || []).length) out.push("line items");
  else if ((p.items || []).some((i) => !str(i.name).trim() || i.unit_price === null || i.unit_price === undefined || str(i.unit_price).trim() === "")) out.push("some prices");
  if (!p.due_date) out.push("due date");
  return out;
}

function toPayload(f) {
  return {
    client_name: f.client_name.trim(),
    client_email: f.client_email.trim(),
    currency: f.currency,
    tax_name: f.tax_name,
    due_date: f.due_date,
    notes: f.notes.trim(),
    items: f.items.map((i) => ({
      name: i.name.trim(),
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      tax_rate: Number(i.tax_rate) || 0,
    })),
  };
}

function problem(f) {
  if (!f.client_name.trim()) return "Add the client's name.";
  if (!/^\S+@\S+\.\S+$/.test(f.client_email.trim())) return "Add a valid client email.";
  if (!f.due_date) return "Choose a due date.";
  for (const [n, i] of f.items.entries()) {
    const row = `Line ${n + 1}`;
    if (!i.name.trim()) return `${row} needs a description.`;
    if (!(Number(i.quantity) > 0)) return `${row} needs a quantity above zero.`;
    if (i.unit_price === "" || !(Number(i.unit_price) >= 0)) return `${row} needs a price.`;
    if (Number(i.tax_rate) < 0 || Number(i.tax_rate) > 100) return `${row} has a tax rate outside 0 to 100.`;
  }
  return "";
}

export default function Studio() {
  const [notes, setNotes] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const toggleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Voice dictation is not supported in this browser. Try Chrome or Edge.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = "en-IN";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
        setError("");
      };

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setNotes((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
      };

      recognition.onerror = (event) => {
        if (event.error === "not-allowed") {
          setError("Microphone permission was denied. Please allow microphone access in your browser.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          setError(`Voice input error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch {
      setIsListening(false);
      setError("Could not start voice input. Please check microphone settings.");
    }
  };

  const [form, setForm] = useState(blank);
  const [missing, setMissing] = useState(null);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const working = useRef(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setItem = (n, patch) =>
    setForm((f) => ({ ...f, items: f.items.map((i, k) => (k === n ? { ...i, ...patch } : i)) }));

  // Live currency converter
  const convertCurrency = (targetCur) => {
    if (form.currency === targetCur) return;
    const oldCur = form.currency;
    const convertedItems = form.items.map((item) => {
      const unit = Number(item.unit_price);
      if (!Number.isFinite(unit) || unit === 0) return item;
      return {
        ...item,
        unit_price: String(convertPrice(unit, oldCur, targetCur)),
      };
    });
    setForm((f) => ({
      ...f,
      currency: targetCur,
      tax_name: targetCur === "INR" ? "GST" : "GST",
      items: convertedItems,
    }));
  };

  async function run(label, fn) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e?.message || "Something went wrong. Please try again.");
    } finally {
      working.current = false;
      setBusy("");
    }
  }

  const readNotes = () =>
    run("Reading your notes", async () => {
      const parsed = await api("/api/parse", { text: notes });
      setForm((f) => fromParsed(parsed, f));
      setMissing(missingFrom(parsed));
    });

  const createDraft = () => {
    const issue = problem(form);
    if (issue) return setError(issue);
    run("Creating the draft on PayPal", async () => {
      setCreated(await api("/api/invoices", toPayload(form)));
    });
  };

  const send = () =>
    run("Sending through PayPal", async () => {
      setCreated(await api(`/api/invoices/${created.id}/send`, {}));
    });

  const reset = () => {
    setForm(blank());
    setNotes("");
    setMissing(null);
    setCreated(null);
    setError("");
  };

  const shareWhatsApp = () => {
    if (!created) return;
    const sum = totals(form.items);
    const invoiceNumber = created.invoice_number || "Draft";
    const msg = `Namaste ${form.client_name || "Client"},\n\nHere is your invoice #${invoiceNumber} for ${form.currency} ${sum.total.toFixed(2)} from BahiKhata.\n\nReview & Pay securely with PayPal:\n${window.location.origin}/app/ledger\n\nThank you for your business!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const options = CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES];

  return (
    <main className="studio">
      <section className="panel" aria-label="Invoice details">
        <header className="studio-intro">
          <p className="eyebrow">Invoice workspace</p>
          <h1>Create an invoice</h1>
          <p>Describe the work, review the details, and prepare an invoice to send through PayPal.</p>
        </header>

        <p className="note">
          Sandbox environment · Payments are simulated. Please do not enter real client details. <Link to="/privacy">Privacy details</Link>
        </p>

        {error && <div className="err" role="alert">{error}</div>}

        {created && (
          <div className="done">
            <p>
              {created.status === "SENT"
                ? `Invoice ${created.invoice_number} was sent to ${created.client_email}.`
                : `Draft ${created.invoice_number} has been created in PayPal. It has not been sent yet.`}
            </p>
            <div className="actions">
              {created.status === "DRAFT" && (
                <button className="btn small" disabled={!!busy} onClick={send}>Send to client</button>
              )}
              <button
                type="button"
                className="btn small"
                onClick={shareWhatsApp}
                title="Share this invoice with client on WhatsApp"
                style={{ background: "#25D366", borderColor: "#25D366", color: "#fff" }}
              >
                💬 Share on WhatsApp
              </button>
              <button
                type="button"
                className="btn small quiet"
                onClick={() => window.print()}
                title="Print or Save invoice as PDF"
              >
                🖨️ Print / PDF
              </button>
              <Link to="/app/ledger" className="btn small quiet">Open the ledger</Link>
              <button className="btn small text" onClick={reset}>Start another</button>
            </div>
            {busy && <div style={{ marginTop: 12 }}><Stroke label={busy} /></div>}
          </div>
        )}

        <fieldset disabled={!!created}>
          <div className="step"><i>01</i><h2>Describe your invoice</h2></div>
          <div className="field">
            <div className="field-head-with-voice">
              <label htmlFor="notes">Invoice description</label>
              <button
                type="button"
                className={`voice-dictate-btn ${isListening ? "listening" : ""}`}
                onClick={toggleVoiceInput}
                disabled={!!busy}
                title="Dictate in English or Hindi / Hinglish"
                aria-label={isListening ? "Stop listening" : "Dictate invoice details with microphone"}
              >
                <span className="voice-mic-icon" aria-hidden="true">
                  {isListening ? "🔴" : "🎙️"}
                </span>
                <span>{isListening ? "Listening... (tap to stop)" : "Voice Dictate (Mic)"}</span>
              </button>
            </div>

            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Speak or type: Brand identity for Meera Shah, 3 days at ₹8,000 per day, plus ₹2,500 for print files. 18% GST; payment due in 15 days."
            />
          </div>

          <div className="actions">
            <button className="btn quiet small" disabled={!!busy || notes.trim().length < 5} onClick={readNotes}>
              Generate invoice details
            </button>
            {busy === "Reading your notes" && <Stroke label={busy} />}
          </div>
          {missing && (
            <p className="hint" style={{ marginTop: 12 }}>
              {missing.length
                ? `Check the form below. I could not find: ${missing.join(", ")}.`
                : "Everything was filled in. Check it before you create the draft."}
            </p>
          )}

          <div className="step"><i>02</i><h2>Client information</h2></div>
          <div className="two">
            <div className="field">
              <label htmlFor="cn">Name</label>
              <input id="cn" value={form.client_name} onChange={(e) => set({ client_name: e.target.value })} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="ce">Email</label>
              <input id="ce" type="email" value={form.client_email} onChange={(e) => set({ client_email: e.target.value })} autoComplete="off" />
            </div>
          </div>

          <div className="step"><i>03</i><h2>Services &amp; line items</h2></div>
          <div className="lines-edit">
            <div className="lines-head">
              <span>Description</span><span>Qty</span><span>Rate</span><span>Tax %</span><span />
            </div>
            {form.items.map((i, n) => (
              <div className="lines-row" key={n}>
                <input aria-label={`Line ${n + 1} description`} value={i.name} onChange={(e) => setItem(n, { name: e.target.value })} />
                <input aria-label={`Line ${n + 1} quantity`} inputMode="decimal" value={i.quantity} onChange={(e) => setItem(n, { quantity: e.target.value })} />
                <input aria-label={`Line ${n + 1} rate`} inputMode="decimal" value={i.unit_price} onChange={(e) => setItem(n, { unit_price: e.target.value })} />
                <input aria-label={`Line ${n + 1} tax percent`} inputMode="decimal" value={i.tax_rate} onChange={(e) => setItem(n, { tax_rate: e.target.value })} />
                {form.items.length > 1 ? (
                  <button className="x" aria-label={`Remove line ${n + 1}`} onClick={() => set({ items: form.items.filter((_, k) => k !== n) })}>×</button>
                ) : <span />}
              </div>
            ))}
          </div>
          <button className="btn text small" onClick={() => set({ items: [...form.items, blankItem()] })}>+ Add line item</button>

          <div className="step"><i>04</i><h2>Payment &amp; tax details</h2></div>
          <div className="two">
            <div className="field">
              <label htmlFor="cur">Currency</label>
              <select id="cur" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                {options.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tax">Tax type</label>
              <select id="tax" value={form.tax_name} onChange={(e) => set({ tax_name: e.target.value })}>
                <option value="GST">GST (CGST and SGST)</option>
                <option value="IGST">IGST (inter-state)</option>
              </select>
            </div>
          </div>
          <p className="hint" style={{ marginTop: -4, marginBottom: 14 }}>
            The tax type is a label. It applies the rate you enter on each line.
          </p>
          <div className="field">
            <label htmlFor="due">Due date</label>
            <input id="due" type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="nt">Message to your client</label>
            <textarea id="nt" style={{ minHeight: 70 }} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>

          <div className="panel-foot">
            <div className="actions">
              <button className="btn" disabled={!!busy || !!created} onClick={createDraft}>Create invoice draft</button>
              {busy === "Creating the draft on PayPal" && <Stroke label="Writing it out" />}
            </div>
          </div>
        </fieldset>
      </section>

      <section className="desk" aria-label="Live invoice preview">
        <header className="studio-preview-head">
          <div>
            <p className="eyebrow">Live preview</p>
            <h2>Your invoice</h2>
          </div>
          <div className="preview-toolbar">
            <button
              type="button"
              className="btn small quiet"
              onClick={() => window.print()}
              title="Print or Save invoice as PDF"
            >
              🖨️ Print / PDF
            </button>
            <span className="studio-preview-status">Updates as you edit</span>
          </div>
        </header>

        {/* Multi-Currency Quick Switcher */}
        <div className="currency-converter-bar">
          <span className="converter-label">Currency Quick-Convert:</span>
          <button
            type="button"
            className={`currency-pill ${form.currency === "INR" ? "active" : ""}`}
            onClick={() => convertCurrency("INR")}
            title="Convert line prices to Indian Rupees"
          >
            ₹ INR (₹86.5/$)
          </button>
          <button
            type="button"
            className={`currency-pill ${form.currency === "USD" ? "active" : ""}`}
            onClick={() => convertCurrency("USD")}
            title="Convert line prices to US Dollars"
          >
            $ USD
          </button>
        </div>

        <InvoiceSheet invoice={form} number={created?.invoice_number} />
        <p className="caption">Review the details and totals before creating your invoice draft.</p>
      </section>
    </main>
  );
}
