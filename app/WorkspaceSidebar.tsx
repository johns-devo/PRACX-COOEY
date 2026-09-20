"use client";

import Link from "next/link";
import type { LocalUser } from "../lib/auth";
import {
  type WorkspaceVariant,
  workspaceBrand,
  workspaceConfigLinks,
  workspaceNavItems,
} from "../lib/workspace-nav";

export function WorkspaceSidebar({
  currentUser,
  variant = "operations",
  activeKey,
}: {
  currentUser: LocalUser;
  variant?: WorkspaceVariant;
  activeKey?: string;
}) {
  const brand = workspaceBrand(variant);
  const navItems = workspaceNavItems(variant);
  const configLinks = workspaceConfigLinks(variant, currentUser.role.toLowerCase() === "administrator");
  const initials = currentUser.fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">PX</span>
        <div>
          <strong>{brand.title}</strong>
          <small>{brand.subtitle}</small>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        <p className="nav-label">Workspace</p>
        {navItems.map((item) => (
          <Link className={`nav-item ${item.key === activeKey ? "active" : ""}`} href={item.href} key={item.key}>
            <span className="nav-dot" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
        <p className="nav-label setup-label">Configuration</p>
        {configLinks.map((item) => (
          <Link
            className={`nav-item ${activeKey === item.key || (activeKey === "setup" && item.key === "setup") ? "active" : ""}`}
            href={item.href}
            key={item.key}
          >
            <span className="nav-dot" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="avatar">{initials}</span>
        <div className="sidebar-user">
          <strong>{currentUser.fullName}</strong>
          <small>{currentUser.role}</small>
        </div>
        <button aria-label="Sign out" className="signout-button" onClick={signOut} type="button">↗</button>
      </div>
    </aside>
  );
}
