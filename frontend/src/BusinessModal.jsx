import { useEffect, useState } from "react";
import { Mark } from "./ui.jsx";
import { api, apiPut } from "./lib.js";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export default function BusinessModal({
  user,
  onClose,
  onUpdateUser,
  onLogout,
  isOnboarding = false,
}) {
  const [isEditing, setIsEditing] = useState(isOnboarding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState(false);

  // Business profile fields
  const [businessName, setBusinessName] = useState(user?.business || "");
  const [businessType, setBusinessType] = useState("Sole Proprietorship");
  const [ownerName, setOwnerName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [address, setAddress] = useState(user?.address || "");
  const [city, setCity] = useState(user?.city || "");
  const [state, setState] = useState(user?.state || "");
  const [postalCode, setPostalCode] = useState(user?.postal_code || "");
  const [gstRegistered, setGstRegistered] = useState(!!user?.gst_registered);
  const [gstin, setGstin] = useState(user?.gstin || "");
  const [pan, setPan] = useState(user?.pan || "");
  const [website, setWebsite] = useState(user?.website || "");

  // Invoicing preferences
  const [currency, setCurrency] = useState(user?.currency || "INR");
  const [taxName, setTaxName] = useState(user?.taxName || "GST");
  const [taxRate, setTaxRate] = useState(user?.taxRate || 18);

  // Load existing profile from backend
  useEffect(() => {
    let active = true;
    async function fetchProfile() {
      try {
        const profile = await api("/api/business/profile");
        if (active && profile && typeof profile === "object") {
          if (profile.business_name) setBusinessName(profile.business_name);
          if (profile.business_type) setBusinessType(profile.business_type);
          if (profile.business_email) setEmail(profile.business_email);
          if (profile.business_phone) setPhone(profile.business_phone);
          if (profile.business_address) setAddress(profile.business_address);
          if (profile.city) setCity(profile.city);
          if (profile.state) setState(profile.state);
          if (profile.postal_code) setPostalCode(profile.postal_code);
          if (typeof profile.gst_registered === "boolean") {
            setGstRegistered(profile.gst_registered);
          }
          if (profile.gstin) setGstin(profile.gstin);
          if (profile.pan) setPan(profile.pan);
          if (profile.website) setWebsite(profile.website);
        }
      } catch {
        // Fall back gracefully to user state
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchProfile();
    return () => {
      active = false;
    };
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

    const cleanName = businessName.trim();
    const cleanType = businessType.trim();
    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();

    if (!cleanName) {
      setError("Please provide your business or trade name.");
      return;
    }
    if (!cleanType) {
      setError("Please select your business structure or type.");
      return;
    }
    if (!cleanEmail) {
      setError("Please provide an official contact email address.");
      return;
    }
    if (!cleanPhone) {
      setError("Please provide a contact phone number.");
      return;
    }

    let cleanGstin = null;
    if (gstRegistered) {
      cleanGstin = gstin.trim().toUpperCase();
      if (!cleanGstin) {
        setError("GSTIN is required for GST-registered businesses.");
        return;
      }
      if (!GSTIN_REGEX.test(cleanGstin)) {
        setError(
          "Invalid GSTIN format. A valid GSTIN has 15 characters (e.g., 29AABCU9603R1ZM)."
        );
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        business_name: cleanName,
        business_type: cleanType,
        business_email: cleanEmail,
        business_phone: cleanPhone,
        business_address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        postal_code: postalCode.trim(),
        gst_registered: gstRegistered,
        gstin: cleanGstin,
        pan: pan.trim() ? pan.trim().toUpperCase() : null,
        website: website.trim() || null,
      };

      await apiPut("/api/business/profile", payload);

      const updatedUser = {
        ...user,
        name: ownerName.trim() || user?.name || cleanName,
        business: cleanName,
        business_type: cleanType,
        email: cleanEmail,
        phone: cleanPhone,
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        postal_code: postalCode.trim(),
        gst_registered: gstRegistered,
        gstin: cleanGstin,
        pan: pan.trim() ? pan.trim().toUpperCase() : null,
        website: website.trim() || null,
        currency,
        taxName,
        taxRate: Number(taxRate) || 18,
        onboarding_completed: true,
        updatedAt: new Date().toISOString(),
      };

      if (onUpdateUser) {
        onUpdateUser(updatedUser);
      }

      setIsEditing(false);
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 3000);

      if (isOnboarding) {
        onClose();
      }
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
            <button
              type="button"
              className="business-modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
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
              {(businessName || ownerName || "B").charAt(0).toUpperCase()}
            </div>
            <div className="business-hero-info">
              <h3>{businessName || "Unnamed Business"}</h3>
              <p className="business-proprietor">
                Proprietor: <b>{ownerName || "Primary Contact"}</b> • {email || user?.email}
              </p>
              <div className="business-tags">
                <span className="business-pill pill-ok">
                  ● PayPal Sandbox Active
                </span>
                <span className="business-pill pill-neutral">
                  {gstRegistered ? `GSTIN: ${gstin || "Configured"}` : "Unregistered under GST"}
                </span>
                <span className="business-pill pill-neutral">
                  Default: {currency} (₹)
                </span>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSave}>
          <div className="business-section">
            <div className="business-section-head">
              <h4>Organization &amp; Contact Details</h4>
              {!isEditing && !isOnboarding && (
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
                <label>Business / Trade Name *</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. Acme Tech Solutions"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{businessName || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Business Structure / Type *</label>
                {isEditing ? (
                  <select
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    required
                  >
                    <option value="Sole Proprietorship">Sole Proprietorship</option>
                    <option value="Freelancer / Consultant">Freelancer / Consultant</option>
                    <option value="Private Limited (Pvt Ltd)">Private Limited (Pvt Ltd)</option>
                    <option value="Limited Liability Partnership (LLP)">Limited Liability Partnership (LLP)</option>
                    <option value="Partnership">Partnership</option>
                    <option value="One Person Company (OPC)">One Person Company (OPC)</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <div className="business-val">{businessType || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Proprietor / Legal Name</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="Your legal name"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{ownerName || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Official Email *</label>
                {isEditing ? (
                  <input
                    type="email"
                    placeholder="billing@yourbusiness.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{email || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Contact Phone / WhatsApp *</label>
                {isEditing ? (
                  <input
                    type="tel"
                    placeholder="e.g. +91 98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                ) : (
                  <div className="business-val">{phone || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Website (Optional)</label>
                {isEditing ? (
                  <input
                    type="url"
                    placeholder="https://yourbusiness.com"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{website || "—"}</div>
                )}
              </div>

              <div className="business-field full-width">
                <label>Registered Office Address</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="Building, street, or landmark"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{address || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>City</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. Bengaluru"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{city || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>State / Province</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. Karnataka"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{state || "—"}</div>
                )}
              </div>

              <div className="business-field">
                <label>Postal Code / PIN</label>
                {isEditing ? (
                  <input
                    type="text"
                    placeholder="e.g. 560001"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                  />
                ) : (
                  <div className="business-val">{postalCode || "—"}</div>
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
                      checked={gstRegistered}
                      onChange={(e) => {
                        setGstRegistered(e.target.checked);
                        if (!e.target.checked) setGstin("");
                      }}
                      style={{ width: "auto" }}
                    />
                  ) : (
                    <span>{gstRegistered ? "☑" : "☐"}</span>
                  )}
                  <span>
                    <b>This business is registered for GST in India</b>
                  </span>
                </label>
                <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                  {gstRegistered
                    ? "Enter your 15-character Goods and Services Tax Identification Number."
                    : "If unregistered or composite, invoices will be issued without GSTIN."}
                </small>
              </div>

              {gstRegistered && (
                <div className="business-field">
                  <label>GSTIN (15 Alphanumeric Characters) *</label>
                  {isEditing ? (
                    <input
                      type="text"
                      maxLength={15}
                      placeholder="e.g. 29AABCU9603R1ZM"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      style={{ textTransform: "uppercase", letterSpacing: "1px", fontFamily: "monospace" }}
                      required={gstRegistered}
                    />
                  ) : (
                    <div className="business-val">
                      <code>{gstin || "Not provided"}</code>
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
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    style={{ textTransform: "uppercase", letterSpacing: "1px", fontFamily: "monospace" }}
                  />
                ) : (
                  <div className="business-val">
                    <code>{pan || "—"}</code>
                  </div>
                )}
              </div>

              <div className="business-field">
                <label>Default Currency</label>
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
                  <div className="business-val">
                    {taxName} ({taxRate}%)
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
              <button
                type="button"
                className="btn small"
                onClick={onClose}
              >
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
