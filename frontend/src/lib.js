export const API = import.meta.env.VITE_API_URL ?? "";

function errorText(detail) {
  if (Array.isArray(detail)) {
    return detail.map((e) => `${e.loc.slice(1).join(".")}: ${e.msg}`).join("; ");
  }
  return detail;
}

export async function api(path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(data.detail) || res.statusText || "Something went wrong");
  return data;
}

export function money(n, currency = "USD") {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
    }).format(n);
  } catch {
    return `${Number(n).toFixed(2)} ${currency}`;
  }
}

export function longDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const toCents = (x) => Math.round(Number((x * 100).toFixed(6)));

// mirrors the backend: each line is rounded to the cent, then its tax is rounded to the cent
export function totals(items) {
  let sub = 0;
  const byRate = {};
  for (const i of items) {
    const line = toCents((Number(i.quantity) || 0) * (Number(i.unit_price) || 0));
    const rate = Number(i.tax_rate) || 0;
    const tax = Math.round(Number(((line * rate) / 100).toFixed(6)));
    sub += line;
    if (rate && tax) byRate[rate] = (byRate[rate] || 0) + tax;
  }
  const taxTotal = Object.values(byRate).reduce((a, b) => a + b, 0);
  return { sub: sub / 100, byRate, tax: taxTotal / 100, total: (sub + taxTotal) / 100 };
}

export function lineAmount(i) {
  return toCents((Number(i.quantity) || 0) * (Number(i.unit_price) || 0)) / 100;
}
