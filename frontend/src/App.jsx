import { useCallback, useEffect, useState } from "react";
import Landing from "./Landing.jsx";
import Studio from "./Studio.jsx";
import Ledger from "./Ledger.jsx";
import Dashboard from "./Dashboard.jsx";
import Insights from "./Insights.jsx";
import Login from "./Login.jsx";
import BusinessModal from "./BusinessModal.jsx";
import { Privacy, Terms } from "./Legal.jsx";
import { Mark } from "./ui.jsx";
import { CONTACT, Link, NavContext } from "./nav.jsx";
import { getStoredUser, setStoredUser, clearStoredUser } from "./auth.js";

const clean = (p) => {
  if (!p) return "/";
  const pathOnly = p.split("?")[0].split("#")[0];
  return pathOnly.length > 1 ? pathOnly.replace(/\\+$/, "") : pathOnly;
};



function Header({ path, user, onLogout, onOpenBusinessModal }) {
  const inApp = path.startsWith("/app");
  const isLogin = path === "/login";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className={inApp ? "top wide" : "top"}>
      <div className="wrap">
        {/* Mobile menu toggle */}
        <button
          className="nav-toggle"
          type="button"
          aria-label="Toggle navigation"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          ☰
        </button>
        <Link to="/" className="brand" aria-label="BahiKhata home">
          <Mark />
          <b>BahiKhata</b>
        </Link>
        {/* Regular navigation (hidden on mobile) */}
        <nav className="nav">
          {isLogin ? (
            <Link to="/" className="btn top-btn-secondary">
              Back to Home
            </Link>
          ) : inApp ? (
            <>
              <Link
                to="/app/dashboard"
                className={path === "/app/dashboard" ? "on" : ""}
              >
                Dashboard
              </Link>

              <Link to="/app" className={path === "/app" ? "on" : ""}>
                Studio
              </Link>

              <Link
                to="/app/ledger"
                className={path === "/app/ledger" ? "on" : ""}
              >
                Ledger
              </Link>

              <Link
                to="/app/insights"
                className={path === "/app/insights" ? "on" : ""}
              >
                AI Insights
              </Link>

              {user && (
                <div className="nav-user">
                  <button
                    type="button"
                    className="user-badge-btn"
                    onClick={onOpenBusinessModal}
                    title="Tap to view business details"
                    aria-label="View business profile"
                  >
                    <span className="user-avatar" aria-hidden="true">
                      {(user.name || user.email || "U").charAt(0)}
                    </span>
                    <span>{user.name || user.email}</span>
                    <span className="user-badge-caret" aria-hidden="true">▾</span>
                  </button>
                  <button
                    type="button"
                    className="btn top-btn-logout"
                    onClick={onLogout}
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {path === "/" && (
                <a className="hide-sm" href="#how">
                  How it works
                </a>
              )}

              {path === "/" && (
                <a className="hide-sm" href="#details">
                  Details
                </a>
              )}

              {user ? (
                <>
                  <button
                    type="button"
                    className="user-badge-btn"
                    onClick={onOpenBusinessModal}
                    title="Tap to view business details"
                    aria-label="View business profile"
                  >
                    <span className="user-avatar" aria-hidden="true">
                      {(user.name || user.email || "U").charAt(0)}
                    </span>
                    <span>{user.name || user.email}</span>
                    <span className="user-badge-caret" aria-hidden="true">▾</span>
                  </button>
                </>
              ) : (
                <Link to="/login" className="btn top-btn-secondary">
                  Sign In
                </Link>
              )}
            </>
          )}
        </nav>
        {/* Mobile navigation overlay */}
        {mobileNavOpen && (
          <nav className="mobile-nav open">
            <button
              className="mobile-nav-close"
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
            >
              ✕
            </button>
            {inApp ? (
              <>
                <Link to="/app/dashboard" onClick={() => setMobileNavOpen(false)}>
                  Dashboard
                </Link>
                <Link to="/app" onClick={() => setMobileNavOpen(false)}>
                  Studio
                </Link>
                <Link to="/app/ledger" onClick={() => setMobileNavOpen(false)}>
                  Ledger
                </Link>
                <Link to="/app/insights" onClick={() => setMobileNavOpen(false)}>
                  AI Insights
                </Link>
              </>
            ) : (
              <>
                <Link to="/" onClick={() => setMobileNavOpen(false)}>
                  Home
                </Link>
                <Link to="/login" onClick={() => setMobileNavOpen(false)}>
                  Sign In
                </Link>
              </>
            )}
          </nav>
        )}
        <nav className="mobile-nav">
          {inApp ? (
            <>
              <Link to="/app/dashboard" onClick={() => setMobileNavOpen(false)}>
                Dashboard
              </Link>
              <Link to="/app" onClick={() => setMobileNavOpen(false)}>
                Studio
              </Link>
              <Link to="/app/ledger" onClick={() => setMobileNavOpen(false)}>
                Ledger
              </Link>
              <Link to="/app/insights" onClick={() => setMobileNavOpen(false)}>
                AI Insights
              </Link>
            </>
          ) : (
            <>
              <Link to="/" onClick={() => setMobileNavOpen(false)}>
                Home
              </Link>
              <Link to="/login" onClick={() => setMobileNavOpen(false)}>
                Sign In
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ compact }) {
  return (
    <footer className={compact ? "foot compact" : "foot"}>
      <div className="wrap">
        <div className="cols">
          <div>
            {compact ? (
              <span>BahiKhata, built by Anurag Shukla.</span>
            ) : (
              <>
                <Link to="/" className="brand">
                  <Mark size={24} />
                  <b>BahiKhata</b>
                </Link>

                <p style={{ marginTop: 10 }}>
                  The AI invoicing assistant. Built for the PayPal AI Hackathon.
                </p>
              </>
            )}
          </div>

          <nav>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms</Link>
            <a href={`mailto:${CONTACT}`}>Contact</a>
          </nav>
        </div>

        {!compact && (
          <small>
            PayPal is a trademark of PayPal, Inc. BahiKhata is an independent
            project and is not affiliated with or endorsed by PayPal or OpenAI.
          </small>
        )}
      </div>
    </footer>
  );
}

const TITLES = {
  "/": "BahiKhata | The AI invoicing assistant",
  "/login": "Sign In | BahiKhata",
  "/app": "Studio | BahiKhata",
  "/app/dashboard": "Dashboard | BahiKhata",
  "/app/ledger": "Ledger | BahiKhata",
  "/app/insights": "AI Insights | BahiKhata",
  "/privacy": "Privacy Policy | BahiKhata",
  "/terms": "Terms and Conditions | BahiKhata",
};

function NotFound() {
  return (
    <main className="wrap page">
      <div className="empty">
        <h2>That page doesn't exist</h2>
        <p>The link may be old or mistyped.</p>
        <Link to="/" className="btn">
          Back to BahiKhata
        </Link>
      </div>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [redirectTarget, setRedirectTarget] = useState(null);
  const [showBusinessModal, setShowBusinessModal] = useState(false);
  const [path, setPath] = useState(() =>
    clean(window.location.pathname)
  );

  // Intercept directly-typed URLs or reloads if not authenticated
  useEffect(() => {
    if (!user && path !== "/" && path !== "/login") {
      setRedirectTarget(path);
      window.history.replaceState({}, "", "/login");
      setPath("/login");
    }
  }, [user, path]);

  // Handle browser back / forward navigation
  useEffect(() => {
    const onPop = () => {
      const next = clean(window.location.pathname);
      if (!user && next !== "/" && next !== "/login") {
        setRedirectTarget(next);
        setPath("/login");
      } else {
        setPath(next);
      }
    };

    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [user]);

  // Update browser tab title
  useEffect(() => {
    document.title = TITLES[path] || "Page not found | BahiKhata";
  }, [path]);

  // Navigation guard callback provided via NavContext
  const go = useCallback(
    (to) => {
      const next = clean(to);

      // If user is not authenticated and attempts to leave landing page:
      if (!user && next !== "/" && next !== "/login") {
        setRedirectTarget(next);
        window.history.pushState({}, "", "/login");
        setPath("/login");
        window.scrollTo(0, 0);
        return;
      }

      window.history.pushState({}, "", to);
      setPath(next);
      window.scrollTo(0, 0);
    },
    [user]
  );

  const handleLogin = (userData) => {
    setStoredUser(userData);
    setUser(userData);
    const destination =
      redirectTarget && redirectTarget !== "/login" && redirectTarget !== "/"
        ? redirectTarget
        : "/app/dashboard";
    setRedirectTarget(null);
    window.history.pushState({}, "", destination);
    setPath(destination);
    window.scrollTo(0, 0);
  };

  const handleLogout = () => {
    clearStoredUser();
    setUser(null);
    setShowBusinessModal(false);
    setRedirectTarget(null);
    window.history.pushState({}, "", "/");
    setPath("/");
    window.scrollTo(0, 0);
  };

  const handleUpdateUser = (updatedUser) => {
    setStoredUser(updatedUser);
    setUser(updatedUser);
  };

  let page;

  if (path === "/") {
    page = <Landing />;
  } else if (path === "/login") {
    page = <Login onLogin={handleLogin} redirectTarget={redirectTarget} />;
  } else if (path === "/app") {
    page = user ? <Studio /> : <Login onLogin={handleLogin} redirectTarget="/app" />;
  } else if (path === "/app/dashboard") {
    page = user ? <Dashboard /> : <Login onLogin={handleLogin} redirectTarget="/app/dashboard" />;
  } else if (path === "/app/ledger") {
    page = user ? <Ledger /> : <Login onLogin={handleLogin} redirectTarget="/app/ledger" />;
  } else if (path === "/app/insights") {
    page = user ? <Insights /> : <Login onLogin={handleLogin} redirectTarget="/app/insights" />;
  } else if (path === "/privacy") {
    page = <Privacy />;
  } else if (path === "/terms") {
    page = <Terms />;
  } else {
    page = <NotFound />;
  }

  return (
    <NavContext.Provider value={go}>
      <Header
        path={path}
        user={user}
        onLogout={handleLogout}
        onOpenBusinessModal={() => setShowBusinessModal(true)}
      />
      {page}
      <Footer compact={path !== "/"} />
      {showBusinessModal && user && (
        <BusinessModal
          user={user}
          onClose={() => setShowBusinessModal(false)}
          onUpdateUser={handleUpdateUser}
          onLogout={handleLogout}
        />
      )}
    </NavContext.Provider>
  );
}
