/**
 * Main Preact application component.
 *
 * This demonstrates a simple SPA with client-side routing.
 */

import { useState } from "preact/hooks";

type Route = "home" | "settings" | "about";

function Navigation({
  current,
  onNavigate,
}: {
  current: Route;
  onNavigate: (route: Route) => void;
}) {
  return (
    <nav style={{ marginBottom: "1rem" }}>
      <button
        onClick={() => onNavigate("home")}
        style={{ fontWeight: current === "home" ? "bold" : "normal" }}
      >
        Home
      </button>
      {" | "}
      <button
        onClick={() => onNavigate("settings")}
        style={{ fontWeight: current === "settings" ? "bold" : "normal" }}
      >
        Settings
      </button>
      {" | "}
      <button
        onClick={() => onNavigate("about")}
        style={{ fontWeight: current === "about" ? "bold" : "normal" }}
      >
        About
      </button>
    </nav>
  );
}

function HomePage() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h2>Home</h2>
      <p>Welcome to the Pick SPA example!</p>
      <p>
        <button onClick={() => setCount((c) => c + 1)}>
          Count: {count}
        </button>
      </p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div>
      <h2>Settings</h2>
      <p>Configure your preferences here.</p>
      <ul>
        <li>Theme: Light</li>
        <li>Language: English</li>
        <li>Notifications: Enabled</li>
      </ul>
    </div>
  );
}

function AboutPage() {
  return (
    <div>
      <h2>About</h2>
      <p>
        This is a demonstration of the Pick client builder with Preact.
      </p>
      <p>
        The client is bundled using esbuild with content hashing for optimal
        caching.
      </p>
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>("home");

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <h1>Pick SPA Example</h1>
      <Navigation current={route} onNavigate={setRoute} />

      {route === "home" && <HomePage />}
      {route === "settings" && <SettingsPage />}
      {route === "about" && <AboutPage />}

      <footer style={{ marginTop: "2rem", color: "#666" }}>
        <p>
          <a href="/">Back to Server Routes</a>
        </p>
      </footer>
    </div>
  );
}
