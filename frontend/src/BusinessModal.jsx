import { useEffect, useState } from "react";
import { Mark } from "./ui.jsx";

export default function BusinessModal({ user, onClose, onUpdateUser, onLogout }) {
  const [isEditing, setIsEditing] = useState(false);
  const [businessName, setBusinessName] = useState(
    user?.business || "Shukla Studio & Accounts"
  );
  const [ownerName, setOwnerName] = useState(
    user?.name || "Anurag Shukla"
  );
  const [email, setEmail] = useState(user?.email || "anurag@bahikhata.in");
  const [phone, setPhone] = useState(user?.phone || "+91 (080) 4123-8890");
  const [address, setAddress] = useState(
    user?.address || "12/4 MG Road, Bengaluru, Karnataka 560001"
  );
  const [gstin, setGstin] = useState(user?.gstin || "29AABCU9603R1ZM");
  const [currency, setCurrency] = useState(user?.currency || "INR");
  const [taxName, setTaxName] = useState(user?.taxName || "GST");
  const [taxRate, setTaxRate] = useState(user?.taxRate || 18);
  const [savedMessage, setSavedMessage] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSave = (e) => {
    e.preventDefault();
    const updatedUser = {
      ...user,
      name: ownerName.trim(),
      email: email.trim(),
      business: businessName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      gstin: gstin.trim(),
      currency,
      taxName,
      taxRate: Number(taxRate) || 18,
      updatedAt: new Date().toISOString(),
    };

    if (onUpdateUser) {
      onUpdateUser(updatedUser);
    }
    setIsEditing(false);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
  };

  return (
    <div
      className="scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Business Profile"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog business-dialog">
        <header className="business-modal-header">
          <div className="business-modal-title-group">
            <Mark size={32} />
            <div>
              <h2>Business Information</h2>
              <p className="sub" style={{ margin: 0 }}>
                Enterprise record, taxation profile, and merchant status.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="business-modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </header>

        {savedMessage && (
          <div className="done" role="status" style={{ marginBottom: 16 }}>
            <b>✓ Saved:</b> Business details successfully updated.
          </div>
        )}

        <div className="business-modal-hero">
          <div className="business-avatar-large">
            {(businessName || ownerName || "B").charAt(0).toUpperCase()}
          </div>
          <div className="business-hero-info">
            <h3>{businessName}</h3>
            <p className="business-proprietor">
              Proprietor: <b>{ownerName}</b> • {email}
            </p>
            <div className="business-tags">
              <span className="business-pill pill-ok">
                ● PayPal Sandbox Active
              </span>
              <span className="business-pill pill-neutral">
                GST Registered
              </span>
              <span className="business-pill pill-neutral">
                Default: {currency} (₹)
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSave}>
          <div className="business-section">
            <div className="business-section-head">
              <h4>Organization &amp; Contact Details</h4>
              {!isEditing && (
                <button
                  type="button"
                  className="btn text small"
                  onClick={() => setIsEditing(true)}
                >
                  Edit Information
                </button>
              )}
            </div>

            <div className="business-grid">
              <div className="business-field">
                <label>Business / Trade Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{businessName}</div>
                )}
              </div>

              <div className="business-field">
                <label>Proprietor / Legal Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{ownerName}</div>
                )}
              </div>

              <div className="business-field">
                <label>Official Email</label>
                {isEditing ? (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{email}</div>
                )}
              </div>

              <div className="business-field">
                <label>Business Phone / WhatsApp</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{phone}</div>
                )}
              </div>

              <div className="business-field full-width">
                <label>Registered Office Address</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{address}</div>
                )}
              </div>
            </div>
          </div>

          <div className="business-section">
            <div className="business-section-head">
              <h4>Taxation &amp; Invoicing Defaults</h4>
            </div>

            <div className="business-grid">
              <div className="business-field">
                <label>GSTIN / Tax ID</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  />
                ) : (
                  <div className="business-val">
                    <code>{gstin}</code>
                  </div>
                )}
              </div>

              <div className="business-field">
                <label>Primary Currency</label>
                {isEditing ? (
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    <option value="INR">INR (₹ Indian Rupee)</option>
                    <option value="USD">USD ($ US Dollar)</option>
                    <option value="EUR">EUR (€ Euro)</option>
                    <option value="GBP">GBP (£ British Pound)</option>
                  </select>
                ) : (
                  <div className="business-val">{currency}</div>
                )}
              </div>

              <div className="business-field">
                <label>Tax Regime &amp; Default Rate</label>
                {isEditing ? (
                  <div className="two" style={{ gap: 8 }}>
                    <select
                      value={taxName}
                      onChange={(e) => setTaxName(e.target.value)}
                    >
                      <option value="GST">GST</option>
                      <option value="IGST">IGST</option>
                    </select>
                    <input
                      type="number"
                      value={taxRate}
                      min="0"
                      max="100"
                      onChange={(e) => setTaxRate(e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="business-val">{taxName} ({taxRate}%)</div>
                )}
              </div>

              <div className="business-field">
                <label>Ledger Timezone</label>
                <div className="business-val">Asia/Kolkata (IST, UTC+05:30)</div>
              </div>
            </div>
          </div>

          <div className="business-section">
            <div className="business-section-head">
              <h4>Connected Integrations</h4>
            </div>

            <div className="business-integration-card">
              <div className="integration-icon">🅿️</div>
              <div className="integration-details">
                <b>PayPal Invoicing Platform</b>
                <p>
                  Sandbox merchant account active. Payment captures and webhook reconciliation enabled.
                </p>
              </div>
              <span className="business-pill pill-ok">Active</span>
            </div>
          </div>

          <footer className="business-modal-foot">
            {isEditing ? (
              <div className="actions">
                <button type="submit" className="btn small">
                  Save Changes
                </button>
                <button
                  type="button"
                  className="btn quiet small"
                  onClick={() => setIsEditing(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn small"
                onClick={onClose}
              >
                Done
              </button>
            )}

            <button
              type="button"
              className="btn quiet small"
              onClick={() => {
                onClose();
                if (onLogout) onLogout();
              }}
              style={{ color: "var(--red)" }}
            >
              Sign Out
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
