/** Parsing and navigation policies for Excel-style direct cell entry. */

export const isPlainArrow = (event) =>
  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
  !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

export const isTypingKey = (key, ctrl, alt) =>
  !ctrl && !alt && typeof key === "string" && [...key].length === 1;

/** Use local calendar fields, not Date.toISOString(): local midnight can
 * belong to the preceding UTC day. Dash date columns carry YYYY-MM-DD.
 */
export const calendarDateString = (date) => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  if (year < 100 || year > 9999) return null;
  return [String(year).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
};

/** Date-only strings must be parsed as local calendar dates; JavaScript's
 * new Date("YYYY-MM-DD") would interpret them as UTC in western time zones.
 */
export const calendarDateFromValue = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return parseDateEntry(value);
  if (value instanceof Date) return value;
  return value ? new Date(value) : undefined;
};

export const parseDateEntry = (text, locale = "en-GB") => {
  const trimmed = String(text ?? "").trim();
  let year, month, day;
  // ISO calendar dates are accepted in every locale.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else {
    // The four-digit year can be first or last, depending on the locale.
    // Require a consistent numeric separator and validate field widths.
    const match = /^(\d{1,4})([\/.\-])(\d{1,2})\2(\d{1,4})$/.exec(trimmed);
    if (!match) return null;
    const fields = [match[1], match[3], match[4]];
    const order = new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "numeric", day: "numeric", calendar: "gregory",
    }).formatToParts(new Date(2001, 11, 22))
      .filter((part) => ["day", "month", "year"].includes(part.type))
      .map((part) => part.type);
    if (order.length !== 3 ||
        fields.some((field, index) =>
          field.length > (order[index] === "year" ? 4 : 2)) ||
        fields[order.indexOf("year")].length !== 4) return null;
    const named = Object.fromEntries(order.map((part, index) =>
      [part, Number(fields[index])]));
    ({ year, month, day } = named);
  }
  if (!Number.isInteger(year) || year < 100 || year > 9999 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month ||
      date.getDate() !== day) return null;
  return date;
};

export const parseTimeEntry = (text, original) => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const [, hours, minutes, seconds = "0"] = match;
  const [h, m, s] = [hours, minutes, seconds].map(Number);
  if (h > 23 || m > 59 || s > 59) return null;
  const date = original instanceof Date && !Number.isNaN(original.getTime())
    ? new Date(original) : new Date(2000, 0, 1);
  date.setHours(h, m, s, 0);
  return date;
};
