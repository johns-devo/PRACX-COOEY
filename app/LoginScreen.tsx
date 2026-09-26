"use client";

import { FormEvent, useState } from "react";
import { isPracxStandalone } from "../lib/app-surface";

export function LoginScreen() {
  const [email, setEmail] = useState("admin@pracx.local");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSigningIn, setSigningIn] = useState(false);
  const pracxStandalone = isPracxStandalone();

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSigningIn(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to sign in.");
      window.location.assign(pracxStandalone ? "/dashboard" : "/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
      setSigningIn(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <p className="login-hero-mark">PRACX</p>
        <h1>{pracxStandalone ? "Billing that follows the claim." : "Connected care. Clean operations."}</h1>
        <p>{pracxStandalone
          ? "From the visit to the payer, and back when it is not paid."
          : "Scheduling, the chart, and the claim in one practice."}</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="login-card-wordmark">
            <span className="brand-mark">PX</span>
            <div>
              <strong>PRACX</strong>
              <small>{pracxStandalone ? "Client billing" : "Practice"}</small>
            </div>
          </div>
          <span className="login-kicker">{pracxStandalone ? "Client billing access" : "Secure practice access"}</span>
          <h2>Welcome back</h2>
          <p className="login-intro">
            {pracxStandalone
              ? "Sign in to configure integrations, then manage claims, payments and reporting."
              : "Sign in to manage scheduling, clinical operations and revenue cycle workflows."}
          </p>

          <form className="login-form" onSubmit={signIn}>
            <label>
              Email address
              <input
                autoComplete="username"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@practice.com"
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Password
              <span className="password-control">
                <input
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            {error && <div className="login-error" role="alert">{error}</div>}

            <div className="login-options">
              <label className="checkbox-label">
                <input type="checkbox" />
                Remember this device
              </label>
              <button className="text-button" type="button">Forgot password?</button>
            </div>

            <button className="login-submit" disabled={isSigningIn} type="submit">
              {isSigningIn ? "Signing in…" : "Sign in to PRACX"}
            </button>
          </form>

          <p className="login-security">
            Protected session · Automatic sign-out after 8 hours
          </p>
        </div>
      </section>
    </main>
  );
}
