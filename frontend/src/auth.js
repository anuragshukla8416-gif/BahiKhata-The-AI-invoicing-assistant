// BahiKhata Authentication Utilities
const AUTH_KEY = "bahikhata_user";
const USERS_KEY = "bahikhata_users";

import { simpleHash } from "./hash.js";

export const DEMO_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Anurag Shukla",
  email: "anurag@bahikhata.in",
  business: "Shukla Studio & Accounts",
  token: "demo_token_anurag_shukla",
  onboarding_completed: true,
  loggedInAt: new Date().toISOString(),
};

// ----- Session handling (single logged‑in user) -----
export function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (user && typeof user === "object" && user.email) {
      return user;
    }
  } catch {
    // Ignore invalid JSON in localStorage
  }
  return null;
}

export function setStoredUser(user) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  } catch (err) {
    console.error("Unable to store user session", err);
  }
}

export function clearStoredUser() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch (err) {
    console.error("Unable to clear user session", err);
  }
}

// ----- Persistent user list (simple "database") -----
export function getAllUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const users = JSON.parse(raw);
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

export function getUserByEmail(email) {
  const users = getAllUsers();
  return users.find((u) => u.email === email);
}

export function addUser(user) {
  // Hash password before storing (simple demo hash)
  if (user.password) {
    user.password = simpleHash(user.password);
  }
  const users = getAllUsers();
  users.push(user);
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch (err) {
    console.error("Unable to persist new user", err);
  }
}
