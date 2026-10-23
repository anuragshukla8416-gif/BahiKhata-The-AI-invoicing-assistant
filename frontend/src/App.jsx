import { useCallback, useEffect, useState } from "react";
import Landing from "./Landing.jsx";
import Studio from "./Studio.jsx";
import Ledger from "./Ledger.jsx";
import Dashboard from "./Dashboard.jsx";
import Insights from "./Insights.jsx";
import { Privacy, Terms } from "./Legal.jsx";
import { Mark } from "./ui.jsx";
import { CONTACT, Link, NavContext } from "./nav.jsx";

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

function Header({ path }) {
  const inApp = path.startsWith("/app");

  return (
    <header className={inApp ? "top wide" : "top"}>
      <div className="wrap">
        <Link to="/" className="brand" aria-label="BahiKhata home">
          <Mark />
          <b>BahiKhata</b>
        </Link>

        <nav className="nav">
          {inApp ? (
            <>
              <Link
                to="/app/dashboard"
                className={path === "/app/dashboard" ? "on" : ""}
              >
                Dashboard
              </Link>

              <Link
                to="/app"
                className={path === "/app" ? "on" : ""}
              >
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

              <Link to="/app/dashboard" className="btn small">
                Open Dashboard
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
  const [path, setPath] = useState(() =>
    clean(window.location.pathname)
  );

  useEffect(() => {
    const onPop = () => setPath(clean(window.location.pathname));

    window.addEventListener("popstate", onPop);

    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.title = TITLES[path] || "Page not found | BahiKhata";
  }, [path]);

  const go = useCallback((to) => {
    const next = clean(to.split("#")[0]);

    window.history.pushState({}, "", to);
    setPath(next);
    window.scrollTo(0, 0);
  }, []);

  let page;

  if (path === "/") {
    page = <Landing />;
  } else if (path === "/app") {
    page = <Studio />;
  } else if (path === "/app/dashboard") {
    page = <Dashboard />;
  } else if (path === "/app/ledger") {
    page = <Ledger />;
  } else if (path === "/app/insights") {
    page = <Insights />;
  } else if (path === "/privacy") {
    page = <Privacy />;
  } else if (path === "/terms") {
    page = <Terms />;
  } else {
    page = <NotFound />;
  }

  return (
    <NavContext.Provider value={go}>
      <Header path={path} />
      {page}
      <Footer compact={path !== "/"} />
    </NavContext.Provider>
  );
}
