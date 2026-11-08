const TRACKING_NAMES = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "yclid", "igshid", "vero_id"])

export function cleanTrackingUrl(input: string): {url: string; changed: boolean; skipped: boolean} {
  const url = new URL(input.trim().replace(/^[<([{]+/, "").replace(/[>\])}.,!?;:'"]+$/, ""))
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http(s)")
  const names = [...url.searchParams.keys()]
  if (names.some((name) => /^(?:sig|signature|token|expires?|expires_at|auth|key)$/i.test(name))) return {url: url.toString(), changed: false, skipped: true}
  for (const name of names) if (/^utm_/i.test(name) || TRACKING_NAMES.has(name.toLowerCase())) url.searchParams.delete(name)
  return {url: url.toString(), changed: url.toString() !== input.trim(), skipped: false}
}

export function firstHttpUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s<>"']+/i)?.[0]
}
