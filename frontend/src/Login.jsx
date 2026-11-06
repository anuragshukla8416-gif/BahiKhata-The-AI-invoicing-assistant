import { useState } from "react";
import { Link } from "./nav.jsx";
import { Mark } from "./ui.jsx";
import { DEMO_USER } from "./auth.js";

export default function Login({ onLogin, redirectTarget }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    if (!password || password.length < 4) {
      setError("Password must be at least 4 characters long.");
      return;
    }

    if (mode === "signup" && !name.trim()) {
      setError("Please provide your full name or business moniker.");
      return;
    }

    setLoading(true);

    // Simulate authenticating session
    setTimeout(() => {
      const displayName =
        mode === "signup"
          ? name.trim()
          : cleanEmail.split("@")[0].replace(/[._-]/g, " ");

      const capitalized = displayName
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      const user = {
        name: capitalized,
        email: cleanEmail,
        business: business.trim() || `${capitalized}'s Practice`,
        token: "session_" + Math.random().toString(36).substring(2, 10),
        loggedInAt: new Date().toISOString(),
        remember,
      };

      setLoading(false);
      onLogin(user);
    }, 300);
  };

  const handleDemoLogin = () => {
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onLogin(DEMO_USER);
    }, 200);
  };

  const targetLabel = (() => {
    if (!redirectTarget || redirectTarget === "/" || redirectTarget === "/login") {
      return null;
    }
    if (redirectTarget.startsWith("/app/dashboard")) return "Dashboard";
    if (redirectTarget.startsWith("/app/ledger")) return "Ledger";
    if (redirectTarget.startsWith("/app/insights")) return "AI Insights";
    if (redirectTarget.startsWith("/app")) return "Invoice Studio";
    return "requested page";
  })();

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand-icon">
            <Mark size={42} />
          </div>
          <h1>{mode === "signin" ? "Sign in to BahiKhata" : "Create your account"}</h1>
          <p>
            {targetLabel
              ? `Sign in to access your ${targetLabel}.`
              : "Smart bookkeeping and AI invoicing through PayPal."}
          </p>
        </div>

        {targetLabel && (
          <div className="note" style={{ marginBottom: 18 }}>
            🔒 <b>Access restricted:</b> Please sign in or use the demo account to view the {targetLabel}.
          </div>
        )}

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={`auth-tab ${mode === "signin" ? "active" : ""}`}
            onClick={() => {
              setMode("signin");
              setError("");
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            Create Account
          </button>
        </div>

        <div className="auth-demo-box">
          <div className="auth-demo-text">
            <span>⚡</span>
            <span>Evaluating or testing BahiKhata?</span>
          </div>
          <button
            type="button"
            className="auth-demo-btn"
            onClick={handleDemoLogin}
            disabled={loading}
          >
            Instant Demo Sign In (Anurag Shukla)
          </button>
        </div>

        <div className="auth-divider">
          <span>or continue with email</span>
        </div>

        {error && <div className="err" role="alert">{error}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <>
              <div className="field">
                <label htmlFor="auth-name">Your Full Name</label>
                <input
                  id="auth-name"
                  type="text"
                  placeholder="e.g. Anurag Shukla"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  disabled={loading}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="auth-business">Business / Studio Name (optional)</label>
                <input
                  id="auth-business"
                  type="text"
                  placeholder="e.g. Shukla Creative Design"
                  value={business}
                  onChange={(e) => setBusiness(e.target.value)}
                  disabled={loading}
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email Address</label>
            <input
              id="auth-email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-input-wrap">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="auth-toggle-pwd"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="auth-options">
            <label className="auth-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={loading}
              />
              <span>Remember me</span>
            </label>
            {mode === "signin" && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                PayPal Sandbox ready
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn auth-submit-btn"
            disabled={loading}
          >
            {loading
              ? "Authenticating..."
              : mode === "signin"
              ? "Sign In to BahiKhata"
              : "Create Account & Enter"}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/" className="auth-back-link">
            ← Back to Landing Page
          </Link>
          <small style={{ color: "var(--muted)" }}>
            BahiKhata • AI Invoicing Assistant
          </small>
        </div>
      </div>
    </main>
  );
}
