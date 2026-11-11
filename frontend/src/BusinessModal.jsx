import { useEffect, useState } from "react";
import { Mark } from "./ui.jsx";
import { api, apiPut } from "./lib.js";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Freelancer / Consultant",
  "Private Limited (Pvt Ltd)",
  "Limited Liability Partnership (LLP)",
  "Partnership",
  "One Person Company (OPC)",
  "Other",
];

export default function BusinessModal({
  user,
  onClose,
  onUpdateUser,
  onLogout,
  isOnboarding = false,
}) {
  const [isEditing, setIsEditing] = useState(isOnboarding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState(false);

  // Consolidated profile state
  const [form, setForm] = useState({
    businessName: user?.business || "",
    businessType: user?.business_type || "Sole Proprietorship",
    ownerName: user?.name || "",
    email: user?.email || "",
    phone: user?.phone || "",
    address: user?.address || "",
    city: user?.city || "",
    state: user?.state || "",
    postalCode: user?.postal_code || "",
    gstRegistered: !!user?.gst_registered,
    gstin: user?.gstin || "",
    pan: user?.pan || "",
    website: user?.website || "",
    currency: user?.currency || "USD",
    taxName: user?.taxName || "GST",
    taxRate: user?.taxRate || 18,
  });

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  // Load existing profile from backend
  useEffect(() => {
    let active = true;
    async function fetchProfile() {
      try {
        const p = await api("/api/business/profile");
        if (active && p && typeof p === "object") {
          setForm((prev) => ({
            ...prev,
            businessName: p.business_name || prev.businessName,
            businessType: p.business_type || prev.businessType,
            email: p.business_email || prev.email,
            phone: p.business_phone || prev.phone,
            address: p.business_address || prev.address,
            city: p.city || prev.city,
            state: p.state || prev.state,
            postalCode: p.postal_code || prev.postalCode,
            gstRegistered: typeof p.gst_registered === "boolean" ? p.gst_registered : prev.gstRegistered,
            gstin: p.gstin || prev.gstin,
            pan: p.pan || prev.pan,
            website: p.website || prev.website,
          }));
        }
      } catch {
        // Fall back gracefully to user state
      }
    }
    fetchProfile();
    return () => { active = false; };
  }, []);

  // Close on Escape key press (unless in mandatory first-time onboarding)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !isOnboarding) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isOnboarding]);

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    const cleanName = form.businessName.trim();
    const cleanType = form.businessType.trim();
    const cleanEmail = form.email.trim();
    const cleanPhone = form.phone.trim();

    if (!cleanName) return setError("Please provide your business or trade name.");
    if (!cleanType) return setError("Please select your business structure or type.");
    if (!cleanEmail) return setError("Please provide an official contact email address.");
    if (!cleanPhone) return setError("Please provide a contact phone number.");

    let cleanGstin = null;
    if (form.gstRegistered) {
      cleanGstin = form.gstin.trim().toUpperCase();
      if (!cleanGstin) return setError("GSTIN is required for GST-registered businesses.");
      if (!GSTIN_REGEX.test(cleanGstin)) {
        return setError("Invalid GSTIN format. A valid GSTIN has 15 characters (e.g., 29AABCU9603R1ZM).");
      }
    }

    setSaving(true);
    try {
      const payload = {
        business_name: cleanName,
        business_type: cleanType,
        business_email: cleanEmail,
        business_phone: cleanPhone,
        business_address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postal_code: form.postalCode.trim(),
        gst_registered: form.gstRegistered,
        gstin: cleanGstin,
        pan: form.pan.trim() ? form.pan.trim().toUpperCase() : null,
        website: form.website.trim() || null,
      };

      await apiPut("/api/business/profile", payload);

      const updatedUser = {
        ...user,
        name: form.ownerName.trim() || user?.name || cleanName,
        business: cleanName,
        business_type: cleanType,
        email: cleanEmail,
        phone: cleanPhone,
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        postal_code: form.postalCode.trim(),
        gst_registered: form.gstRegistered,
        gstin: cleanGstin,
        pan: form.pan.trim() ? form.pan.trim().toUpperCase() : null,
        website: form.website.trim() || null,
        currency: form.currency,
        taxName: form.taxName,
        taxRate: Number(form.taxRate) || 18,
        onboarding_completed: true,
        updatedAt: new Date().toISOString(),
      };

      if (onUpdateUser) onUpdateUser(updatedUser);
      setIsEditing(false);
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 3000);
      if (isOnboarding) onClose();
    } catch (err) {
      setError(err.message || "Failed to update business profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Business Profile"
      onMouseDown={(e) => {
        if (!isOnboarding && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog business-dialog">
        <header className="business-modal-header">
          <div className="business-modal-title-group">
            <Mark size={32} />
            <div>
              <h2>{isOnboarding ? "Setup Your Business Profile" : "Business Information"}</h2>
              <p className="sub" style={{ margin: 0 }}>
                {isOnboarding
                  ? "Enter your genuine business details to configure your multi-tenant workspace."
                  : "Enterprise record, taxation profile, and merchant status."}
              </p>
            </div>
          </div>
          {!isOnboarding && (
            <button type="button" className="business-modal-close" onClick={onClose} aria-label="Close dialog">
              ✕
            </button>
          )}
        </header>

        {savedMessage && (
          <div className="done" role="status" style={{ marginBottom: 16 }}>
            <b>✓ Saved:</b> Business details successfully updated.
          </div>
        )}

        {error && (
          <div className="err" role="alert" style={{ marginBottom: 16 }}>
            <b>Error:</b> {error}
          </div>
        )}

        {!isOnboarding && (
          <div className="business-modal-hero">
            <div className="business-avatar-large">
              {(form.businessName || form.ownerName || "B").charAt(0).toUpperCase()}
            </div>
            <div className="business-hero-info">
              <h3>{form.businessName || "Unnamed Business"}</h3>
              <p className="business-proprietor">
                Proprietor: <b>{form.ownerName || "Primary Contact"}</b> • {form.email || user?.email}
              </p>
              <div className="business-tags">
                <span className="business-pill pill-ok">● PayPal Sandbox Active</span>
                <span className="business-pill pill-neutral">
                  {form.gstRegistered ? `GSTIN: ${form.gstin || "Configured"}` : "Unregistered under GST"}
                </span>
                <span className="business-pill pill-neutral">Default: {form.currency} (₹)</span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSave}>
          <div className="business-section">
            <div className="business-section-head">
              <h4>Organization &amp; Contact Details</h4>
              {!isEditing && !isOnboarding && (
                <button type="button" className="btn text small" onClick={() => setIsEditing(true)}>
                  Edit Information
                </button>
              )}
            </div>

            <div className="business-grid">
              <div className="business-field">
                <label>Business / Trade Name *</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. Acme Tech Solutions"
                    value={form.businessName}
                    onChange={(e) => set("businessName", e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{form.businessName || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Business Structure / Type *</label>
                {isEditing ? (
                  <select
                    value={form.businessType}
                    onChange={(e) => set("businessType", e.target.value)}
                    required
                  >
                    {BUSINESS_TYPES.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                ) : (
                  <div className="business-val">{form.businessType || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Proprietor / Legal Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="Your legal name"
                    value={form.ownerName}
                    onChange={(e) => set("ownerName", e.target.value)}
                  />
                ) : (
                  <div className="business-val">{form.ownerName || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Official Email *</label>
                {isEditing ? (
                  <input
                    type="email"
                    placeholder="billing@yourbusiness.com"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{form.email || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Contact Phone / WhatsApp *</label>
                {isEditing ? (
                  <input
                    type="tel"
                    placeholder="e.g. +91 98765 43210"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{form.phone || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Website (Optional)</label>
                {isEditing ? (
                  <input
                    type="url"
                    placeholder="https://yourbusiness.com"
                    value={form.website}
                    onChange={(e) => set("website", e.target.value)}
                  />
                ) : (
                  <div className="business-val">{form.website || "—"}</div>
                )}
              </div>

              <div className="business-field full-width">
                <label>Registered Office Address</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="Building, street, or landmark"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                  />
                ) : (
                  <div className="business-val">{form.address || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>City</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. Bengaluru"
                    value={form.city}
                    onChange={(e) => set("city", e.target.value)}
                  />
                ) : (
                  <div className="business-val">{form.city || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>State / Province</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. Karnataka"
                    value={form.state}
                    onChange={(e) => set("state", e.target.value)}
                  />
                ) : (
                  <div className="business-val">{form.state || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Postal Code / PIN</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. 560001"
                    value={form.postalCode}
                    onChange={(e) => set("postalCode", e.target.value)}
                  />
                ) : (
                  <div className="business-val">{form.postalCode || "—"}</div>
                )}
              </div>
            </div>
          </div>

          <div className="business-section">
            <div className="business-section-head">
              <h4>Taxation &amp; GST Compliance</h4>
            </div>

            <div className="business-grid">
              <div className="business-field full-width">
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  {isEditing ? (
                    <input
                      type="checkbox"
                      checked={form.gstRegistered}
                      onChange={(e) => {
                        set("gstRegistered", e.target.checked);
                        if (!e.target.checked) set("gstin", "");
                      }}
                      style={{ width: "auto" }}
                    />
                  ) : (
                    <span>{form.gstRegistered ? "☑" : "☐"}</span>
                  )}
                  <span>
                    <b>This business is registered for GST in India</b>
                  </span>
                </label>
                <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                  {form.gstRegistered
                    ? "Enter your 15-character Goods and Services Tax Identification Number."
                    : "If unregistered or composite, invoices will be issued without GSTIN."}
                </small>
              </div>

              {form.gstRegistered && (
                <div className="business-field">
                  <label>GSTIN (15 Alphanumeric Characters) *</label>
                  {isEditing ? (
                    <input
                      type="text"
                      maxLength={15}
                      placeholder="e.g. 29AABCU9603R1ZM"
                      value={form.gstin}
                      onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                      style={{ textTransform: "uppercase", letterSpacing: "1px", fontFamily: "monospace" }}
                      required={form.gstRegistered}
                    />
                  ) : (
                    <div className="business-val">
                      <code>{form.gstin || "Not provided"}</code>
                    </div>
                  )}
                </div>
              )}

              <div className="business-field">
                <label>Permanent Account Number (PAN) (Optional)</label>
                {isEditing ? (
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="e.g. ABCDE1234F"
                    value={form.pan}
                    onChange={(e) => set("pan", e.target.value.toUpperCase())}
                    style={{ textTransform: "uppercase", letterSpacing: "1px", fontFamily: "monospace" }}
                  />
                ) : (
                  <div className="business-val">
                    <code>{form.pan || "—"}</code>
                  </div>
                )}
              </div>

              <div className="business-field">
                <label>Default Currency</label>
                {isEditing ? (
                  <select
                    value={form.currency}
                    onChange={(e) => set("currency", e.target.value)}
                  >
                    <option value="USD">USD ($ US Dollar)</option>
                    <option value="INR">INR (₹ Indian Rupee)</option>
                    <option value="EUR">EUR (€ Euro)</option>
                    <option value="GBP">GBP (£ British Pound)</option>
                  </select>
                ) : (
                  <div className="business-val">{form.currency}</div>
                )}
              </div>

              <div className="business-field">
                <label>Tax Regime &amp; Default Rate</label>
                {isEditing ? (
                  <div className="two" style={{ gap: 8 }}>
                    <select
                      value={form.taxName}
                      onChange={(e) => set("taxName", e.target.value)}
                    >
                      <option value="GST">GST</option>
                      <option value="IGST">IGST</option>
                    </select>
                    <input
                      type="number"
                      value={form.taxRate}
                      min="0"
                      max="100"
                      onChange={(e) => set("taxRate", e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="business-val">
                    {form.taxName} ({form.taxRate}%)
                  </div>
                )}
              </div>
            </div>
          </div>

          <footer className="business-modal-foot">
            {isEditing ? (
              <div className="actions">
                <button type="submit" className="btn small" disabled={saving}>
                  {saving ? "Saving..." : isOnboarding ? "Complete Onboarding" : "Save Changes"}
                </button>
                {!isOnboarding && (
                  <button
                    type="button"
                    className="btn quiet small"
                    onClick={() => {
                      setIsEditing(false);
                      setError("");
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ) : (
              <button type="button" className="btn small" onClick={onClose}>
                Done
              </button>
            )}

            {!isOnboarding && onLogout && (
              <button
                type="button"
                className="btn quiet small"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                style={{ color: "var(--red)" }}
              >
                Sign Out
              </button>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}
