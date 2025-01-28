
class NumberParser {
  constructor(locale) {
    const format = new Intl.NumberFormat(locale);
    const parts = format.formatToParts(1234.56);
    const numerals = Array.from({ length: 10 }).map((_, i) => format.format(i));
    const index = new Map(numerals.map((d, i) => [d, i]));
    this._group = new RegExp(`[${parts.find(d => d.type === "group").value}]`, "g");
    this._decimal = new RegExp(`[${parts.find(d => d.type === "decimal").value}]`);
    this._numeral = new RegExp(`[${numerals.join("")}]`, "g");
    this._index = d => index.get(d);
  }
  parse(string) {
    string = string.trim()
      .replace(this._group, "")
      .replace(this._decimal, ".")
      .replace(this._numeral, this._index)
    return parseFloat(string ? +string : NaN);;
  }
}

class PercentParser {
  constructor(locale) {
    const format = new Intl.NumberFormat(locale, { style: 'percent', 'maximumFractionDigits': 20 });
    const parts = format.formatToParts(1234.56789);
    const numerals = Array.from({ length: 10 }).map((_, i) => format.format(i / 100).slice(0, -1));
    const index = new Map(numerals.map((d, i) => [d, i]));
    this._group = new RegExp(`[${parts.find(d => d.type === "group").value}]`, "g");
    this._decimal = new RegExp(`[${parts.find(d => d.type === "decimal").value}]`);
    this._numeral = new RegExp(`[${numerals.join("")}]`, "g");
    this._percentSign = parts.find(d => d.type === "percentSign").value
    const literalPart = parts.find(d => d.type === "literal")
    this._literal = literalPart ? literalPart.value : ""
    this._index = d => index.get(d);
  }
  parse(string) {
    const formattedString = string.trim()
      .replace(this._group, "")
      .replace(this._decimal, ".")
      //.replace(this._numeral, this._index)
      .replace(this._percentSign, "")
      .replace(this._literal, "")
    return parseFloat(string = formattedString ? +formattedString : NaN) / 100;
  }
}

export { NumberParser, PercentParser }