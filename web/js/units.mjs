export function normalizeSIUnit(unit) {
  if (unit == null) return "";
  const value = String(unit).trim();
  if (!value) return "";
  const compact = value.replace(/\s+/g, "");
  const lower = compact.toLowerCase();

  const siMatch = /^([numkmgμµ]?)(wh|va|pa|hz|w|v|a|b)(?:[_-]?(?:rms|eff))?$/i.exec(compact);
  if (siMatch) {
    const prefixRaw = siMatch[1] || "";
    const baseRaw = (siMatch[2] || "").toLowerCase();
    const baseMap = new Map([
      ["wh", "Wh"],
      ["va", "VA"],
      ["pa", "Pa"],
      ["hz", "Hz"],
      ["w", "W"],
      ["v", "V"],
      ["a", "A"],
      ["b", "B"],
    ]);
    const base = baseMap.get(baseRaw);
    if (base) {
      let prefix = "";
      if (prefixRaw === "n" || prefixRaw === "N") prefix = "n";
      else if (prefixRaw === "u" || prefixRaw === "U" || prefixRaw === "μ" || prefixRaw === "µ") prefix = "u";
      else if (prefixRaw === "m") prefix = "m";
      else if (prefixRaw === "k" || prefixRaw === "K") prefix = "k";
      else if (prefixRaw === "M") prefix = "M";
      else if (prefixRaw === "g" || prefixRaw === "G") prefix = "G";
      return `${prefix}${base}`;
    }
  }

  if (lower === "volt" || lower === "volts") return "V";
  if (lower === "kilovolt" || lower === "kilovolts") return "kV";
  if (lower === "watt" || lower === "watts") return "W";
  if (lower === "kilowatt" || lower === "kilowatts" || lower === "kilowatts") return "kW";

  switch (value) {
    case "kiloWatts":
    case "kilowatts":
      return "kW";
    case "wattHours":
      return "Wh";
    case "kilowattHours":
      return "kWh";
    case "Watts":
    case "watts":
      return "W";
    case "degC":
    case "degreesCelsius":
      return "°C";
    case "cubicMeters":
      return "m³";
    case "cubicMetersPerHour":
      return "m³/h";
    case "hertz":
      return "Hz";
    case "kilovoltAmperes":
    case "kilovoltAmperesReactive":
      return "kVA";
    case "bytes":
      return "B";
    case "bars":
      return "bar";
    case "amperes":
      return "A";
    case "volts":
      return "V";
    case "kilovolts":
      return "kV";
    case "litersPerHour":
      return "l/h";
    case "litersPerMinute":
    case "LMin":
      return "l/min";
    case "litersPerSecond":
      return "l/s";
    case "metersPerSecond":
      return "m/s";
    case "None":
    case "nan":
    case "noUnits":
      return "1";
    case "pascals":
      return "Pa";
    case "partsPerMillion":
      return "ppm";
    case "percent":
    case "percentRelativeHumidity":
      return "%";
    case "RPM":
      return "rpm";
    case "voltAmperes":
      return "VA";
    case "millimeters":
      return "mm";
    case "minutes":
      return "min";
    default:
      return value;
  }
}
