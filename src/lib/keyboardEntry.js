/** Parsing and navigation policies for Excel-style direct cell entry. */

export const isPlainArrow = (event) =>
  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
  !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

export const isTypingKey = (key, ctrl, alt) =>
  !ctrl && !alt && typeof key === "string" && [...key].length === 1;

export const parseDateEntry = (text, locale = "en-GB") => {
  const trimmed = String(text ?? "").trim();
  let year, month, day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (match) {
    [, year, month, day] = match.map(Number);
  } else {
    match = /^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/.exec(trimmed);
    if (!match) return null;
    const order = new Intl.DateTimeFormat(locale).formatToParts(new Date(2001, 11, 22))
      .filter((part) => ["day", "month", "year"].includes(part.type))
      .map((part) => part.type);
    const named = Object.fromEntries(order.map((part, index) => [part, Number(match[index + 1])]));
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
