// BahiKhata Authentication Utilities
const AUTH_KEY = "bahikhata_user";

export const DEMO_USER = {
  name: "Anurag Shukla",
  email: "anurag@bahikhata.in",
  business: "Shukla Studio & Accounts",
  token: "demo_token_" + Date.now(),
  loggedInAt: new Date().toISOString(),
};

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
