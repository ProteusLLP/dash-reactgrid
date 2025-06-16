import { DateTime } from "luxon";

function shortPattern(locale) {
  // 31 Dec 1999 is safe (no leading zero), use it as a probe
  const probe = new Date(1999, 11, 31);             // 31-12-1999
  const parts = new Intl.DateTimeFormat(
    locale,
    { dateStyle: "short" }
  ).formatToParts(probe);

  return parts
    .map(p => {
      switch (p.type) {
        case "day":   return p.value.length === 2 ? "dd" : "d";
        case "month": return p.value.length === 2 ? "MM" : "M";
        case "year":  return p.value.length === 4 ? "yyyy" : "yy";
        case "literal": return p.value;                     // keep the slash/dot
        default: return "";
      }
    })
    .join("");
}

export function parseLocaleDate(text, locale) {
  // 1️⃣ candidate patterns in *this* locale
  const pattern = shortPattern(locale);          // e.g. "dd/MM/yyyy"
  const dt = DateTime.fromFormat(text, pattern, { locale });
  if (dt.isValid) return dt
  // try UTC
  const utc = DateTime.fromFormat(text, "yyyy-MM-dd'T'HH:mm:ss.SSSZZ", { locale });
  if (utc.isValid) return utc;
  // 3️⃣ last-ditch: ISO / browser parse
  const iso = DateTime.fromISO(text,{locale});
  return iso.isValid ? iso : null;
}
