// Simple test script for auth utilities
import { addUser, getUserByEmail, clearStoredUser, simpleHash } from './src/auth.js';

// Mock localStorage for Node
global.localStorage = {
  _store: {},
  getItem(key) { return this._store[key] ?? null; },
  setItem(key, value) { this._store[key] = value; },
  removeItem(key) { delete this._store[key]; },
  clear() { this._store = {}; },
};

// Ensure clean state
clearStoredUser();
localStorage.clear();

// Create a test user
const testEmail = 'test@example.com';
const testPwd = 'secret';
const hashed = simpleHash(testPwd);
addUser({ email: testEmail, password: hashed, name: 'Test User', business: '', token: 'token_' + Date.now(), loggedInAt: new Date().toISOString() });

// Simulate sign‑in logic from Login.jsx
function signIn(email, pwd) {
  const user = getUserByEmail(email.trim());
  if (!user) {
    clearStoredUser();
    return { error: 'No account found. Please create an account.' };
  }
  if (user.password !== simpleHash(pwd)) {
    return { error: 'Incorrect password.' };
  }
  // simulate setStoredUser
  setStoredUser(user);
  return { user };
}

// Test cases
console.log('--- Existing user, correct password ---', signIn(testEmail, testPwd));
console.log('--- Existing user, wrong password ---', signIn(testEmail, 'bad'));
console.log('--- Missing user ---', signIn('missing@example.com', 'any'));
