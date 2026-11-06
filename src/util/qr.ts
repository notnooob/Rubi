import QRCode from "qrcode"

/** Same limit the SimpleX apps use for inline image previews (data URI chars). */
const MAX_DATA_URI = 12_500

/**
 * QR code as a PNG data URI small enough to send inline (`ctx.replyImage`).
 * Starts big and shrinks until it fits the SimpleX preview budget.
 */
export async function qrDataUri(text: string): Promise<string> {
  for (const scale of [8, 6, 5, 4, 3]) {
    const uri = await QRCode.toDataURL(text, {errorCorrectionLevel: "M", margin: 2, scale, color: {dark: "#1e0b3aff", light: "#ffffffff"}})
    if (uri.length <= MAX_DATA_URI) return uri
  }
  throw new Error("text too long for a QR code image")
}
