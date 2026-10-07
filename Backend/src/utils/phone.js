// Phone-number normalization — the one place that decides what a phone number
// looks like on disk.
//
// `User.phone` stores digits ONLY, with the country code and without any
// separator or "+": "0300 1234567", "+92-300-1234567" and "00923001234567"
// all normalize to "923001234567". That single canonical form is what the
// uniqueness index compares, so the same person cannot register twice by
// formatting the number differently.
//
// Accepted input shapes:
//   +<cc>…          international, country code already included
//   00<cc>…         international dialing prefix, country code included
//   0…              local number with the national trunk prefix ("0")
//   <cc>…           already in country code form without a "+"
//   anything else   the default country code (DEFAULT_PHONE_COUNTRY_CODE,
//                   92 = Pakistan unless the owner changes it) is prepended
//                   after stripping trunk zeros.
//
// Returns the digits-only string, or null when the input cannot be a phone
// number (fewer than 7 or more than 15 digits — the E.164 maximum).

const DEFAULT_CC = "92";

export function defaultCountryCode() {
  const raw = process.env.DEFAULT_PHONE_COUNTRY_CODE || DEFAULT_CC;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 1 && digits.length <= 3 ? digits : DEFAULT_CC;
}

/** Display form: re-adds the "+" that storage strips. Never used for lookups. */
export function formatPhone(stored) {
  return typeof stored === "string" && /^\d{7,15}$/.test(stored) ? `+${stored}` : stored || "";
}

export function normalizePhone(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let digits;
  if (trimmed.startsWith("+")) {
    digits = trimmed.slice(1).replace(/\D/g, "");
  } else if (trimmed.startsWith("00")) {
    digits = trimmed.slice(2).replace(/\D/g, "");
  } else {
    const local = trimmed.replace(/\D/g, "");
    if (!local) return null;
    const cc = defaultCountryCode();
    const withoutTrunk = local.replace(/^0+/, "");
    // A local number never starts with the country code in practice (Pakistan
    // numbers are 03…, not 923…), so "already in cc form" only matches when
    // someone typed the international form without a "+"/"00" prefix.
    digits = withoutTrunk.startsWith(cc) && withoutTrunk.length > cc.length
      ? withoutTrunk
      : cc + withoutTrunk;
  }

  if (!/^\d{7,15}$/.test(digits)) return null;
  return digits;
}

/** True when the string is usable as a phone number after normalization. */
export const isValidPhone = (raw) => normalizePhone(raw) !== null;

export default { normalizePhone, isValidPhone, formatPhone, defaultCountryCode };
