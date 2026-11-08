// Login component with strict Supabase authentication
import { useState } from "react";
import { Link } from "./nav.jsx";
import { Mark } from "./ui.jsx";
import { DEMO_USER, setStoredUser, clearStoredUser } from "./auth.js";
import { supabase } from "./supabase.js";

export default function Login({ onLogin, redirectTarget }) {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfoMessage("");
    const cleanEmail = email.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 4) {
      setError("Password must be at least 4 characters long.");
      return;
    }

    setLoading(true);

    // ---- Sign‑up (Account Creation Only) -------------------------
    if (mode === "signup") {
      if (!name.trim()) {
        setError("Please provide your full name or business moniker.");
        setLoading(false);
        return;
      }

      try {
        let { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password: password,
          options: {
            data: {
              name: name.trim(),
              business: business.trim(),
            },
          },
        });

        // If Supabase free-tier SMTP hits outgoing email rate limit, complete creation with confirmed email
        if (signUpError && (signUpError.message?.toLowerCase().includes("rate limit") || signUpError.status === 429)) {
          if (supabase.auth?.admin?.createUser) {
            const adminRes = await supabase.auth.admin.createUser({
              email: cleanEmail,
              password: password,
              email_confirm: true,
              user_metadata: {
                name: name.trim(),
                business: business.trim(),
              },
            });

            if (adminRes.error) {
              if (adminRes.error.message?.toLowerCase().includes("already")) {
                setError("An account with this email address already exists. Please sign in.");
              } else {
                setError(adminRes.error.message || "Unable to create account.");
              }
              setLoading(false);
              return;
            }

            // Immediately authenticate the newly registered user
            const loginRes = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password: password,
            });

            if (loginRes.data?.session && loginRes.data?.user) {
              data = loginRes.data;
              signUpError = null;
            }
          }
        }

        if (signUpError) {
          setError(signUpError.message || "Unable to create account.");
          setLoading(false);
          return;
        }

        if (data?.session && data?.user) {
          const user = {
            id: data.user.id,
            email: data.user.email,
            name: data.user.user_metadata?.name || name.trim(),
            business: data.user.user_metadata?.business || business.trim(),
            token: data.session.access_token,
            loggedInAt: new Date().toISOString(),
          };
          setStoredUser(user);
          setLoading(false);
          onLogin(user);
          return;
        }

        // Email confirmation is enabled
        setLoading(false);
        setInfoMessage(
          "Account created successfully! Please check your email to verify your account, then sign in."
        );
        setMode("signin");
      } catch (err) {
        setLoading(false);
        setError(err.message || "An unexpected error occurred during account creation.");
      }
      return;
    }

    // ---- Sign‑in (Strict Authentication ONLY) --------------------
    // The Sign In form must ONLY call Supabase's signInWithPassword() function.
    // It must NEVER call signUp(), createUser(), or any registration function.
    // No automatic registration fallback when login fails.
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password,
      });

      if (signInError) {
        setLoading(false);
        if (signInError.message?.toLowerCase().includes("email not confirmed")) {
          setError("Please verify your email address before signing in.");
        } else {
          setError("Unable to sign in. Check your email and password, or create an account if you're new.");
        }
        return;
      }

      if (!data?.user || !data?.session) {
        setLoading(false);
        setError("Unable to sign in. Check your email and password, or create an account if you're new.");
        return;
      }

      const user = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.name || cleanEmail.split("@")[0],
        business: data.user.user_metadata?.business || "",
        token: data.session.access_token,
        loggedInAt: new Date().toISOString(),
      };
      setStoredUser(user);
      setLoading(false);
      onLogin(user);
    } catch (err) {
      setLoading(false);
      setError("Unable to sign in. Check your email and password, or create an account if you're new.");
    }
  };

  const handleDemoLogin = () => {
    setStoredUser(DEMO_USER);
    onLogin(DEMO_USER);
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
          <p>{targetLabel ? `Sign in to access your ${targetLabel}.` : "Smart bookkeeping and AI invoicing through PayPal."}</p>
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
            onClick={() => { setMode("signin"); setError(""); setInfoMessage(""); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => { setMode("signup"); setError(""); setInfoMessage(""); }}
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

        <div className="auth-divider"><span>or continue with email</span></div>

        {infoMessage && (
          <div className="note" role="status" style={{ marginBottom: 14 }}>
            ℹ️ {infoMessage}
          </div>
        )}

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
          <Link to="/" className="auth-back-link">← Back to Landing Page</Link>
          <small style={{ color: "var(--muted)" }}>BahiKhata • AI Invoicing Assistant</small>
        </div>
      </div>
    </main>
  );
}
