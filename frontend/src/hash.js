// Simple deterministic hash (djb2) for demo purposes
export function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32‑bit integer and to hex string
  return (hash >>> 0).toString(16);
}
