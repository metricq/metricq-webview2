export function normalizeSIUnit(unit) {
  if (unit == null) return "";
  const value = String(unit).trim();
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
