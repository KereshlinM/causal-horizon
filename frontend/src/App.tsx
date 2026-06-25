import { useState } from "react";
import Entities from "./pages/Entities";
import Overview from "./pages/Overview";
import Signals from "./pages/Signals";
import Webhooks from "./pages/Webhooks";

type Page = "overview" | "entities" | "signals" | "webhooks";

const NAV: { id: Page; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "entities", label: "Entities" },
  { id: "signals", label: "Signals" },
  { id: "webhooks", label: "Webhooks" },
];

function ApiKeyModal({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="logo-icon" style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
        <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>Causal Horizon</h2>
        <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>
          Enter your API key to continue.
        </p>
        <input
          className="form-input"
          placeholder="ch_..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && onSave(key.trim())}
          autoFocus
        />
        <button
          className="btn btn-primary"
          style={{ marginTop: 12, width: "100%" }}
          onClick={() => key.trim() && onSave(key.trim())}
          disabled={!key.trim()}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => localStorage.getItem("ch_api_key"));
  const [page, setPage] = useState<Page>("overview");

  if (!apiKey) {
    return (
      <ApiKeyModal
        onSave={(key) => {
          localStorage.setItem("ch_api_key", key);
          setApiKey(key);
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">horizon</span>
        </div>
        <div className="sidebar-nav">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "active" : ""}`}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button
            className="nav-item"
            onClick={() => {
              localStorage.removeItem("ch_api_key");
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="main-content">
        {page === "overview" && <Overview />}
        {page === "entities" && <Entities />}
        {page === "signals" && <Signals />}
        {page === "webhooks" && <Webhooks />}
      </main>
    </div>
  );
}
