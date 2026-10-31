// WhatsApp opt-in link for the registration success screen. The player
// taps it, WhatsApp opens with a message to the club number holding their
// code, and sending it is the opt-in (supabase/functions/whatsapp-inbound
// reads the code with the same rule as optinCode below).

// First 8 characters of the registration id, e.g. "1A2B3C4D".
export function optinCode(registrationId: string): string {
  return registrationId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function optinMessage(tournamentName: string, registrationId: string): string {
  return `Hi! Please send me WhatsApp updates for ${tournamentName}. My code: ${optinCode(registrationId)}`;
}

// https://wa.me/<digits>?text=… opens WhatsApp (app or web) with the
// message typed in, ready to send. Null if the club number isn't usable.
export function optinLink(clubNumber: string | null, tournamentName: string, registrationId: string): string | null {
  const digits = (clubNumber ?? "").replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(optinMessage(tournamentName, registrationId))}`;
}

// "+1 778 964 6999" for North American numbers, "+91 98183 38393" for
// Indian mobiles, "+<digits>" otherwise. Same as formatClubNumber in
// supabase/functions/_shared/whatsapp.ts.
export function formatClubNumber(clubNumber: string): string {
  const d = clubNumber.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return `+${d}`;
}
