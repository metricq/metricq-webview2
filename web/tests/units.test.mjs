import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSIUnit } from "../js/units.mjs";

test("normalizeSIUnit maps legacy MetricQ units to canonical short forms", () => {
  assert.equal(normalizeSIUnit("kiloWatts"), "kW");
  assert.equal(normalizeSIUnit("Watts"), "W");
  assert.equal(normalizeSIUnit("degreesCelsius"), "°C");
  assert.equal(normalizeSIUnit("percentRelativeHumidity"), "%");
  assert.equal(normalizeSIUnit("LMin"), "l/min");
  assert.equal(normalizeSIUnit("noUnits"), "1");
});

test("normalizeSIUnit keeps unknown values and handles empty input", () => {
  assert.equal(normalizeSIUnit("customUnit"), "customUnit");
  assert.equal(normalizeSIUnit("  volts  "), "V");
  assert.equal(normalizeSIUnit(null), "");
  assert.equal(normalizeSIUnit(undefined), "");
});

test("normalizeSIUnit extended mapping table", () => {
  const cases = [
    ["kilowatts", "kW"],
    ["wattHours", "Wh"],
    ["kilowattHours", "kWh"],
    ["degC", "°C"],
    ["cubicMeters", "m³"],
    ["cubicMetersPerHour", "m³/h"],
    ["hertz", "Hz"],
    ["kilovoltAmperes", "kVA"],
    ["kilovoltAmperesReactive", "kVA"],
    ["bytes", "B"],
    ["bars", "bar"],
    ["amperes", "A"],
    ["volts", "V"],
    ["kilovolts", "kV"],
    ["litersPerHour", "l/h"],
    ["litersPerMinute", "l/min"],
    ["litersPerSecond", "l/s"],
    ["metersPerSecond", "m/s"],
    ["None", "1"],
    ["nan", "1"],
    ["pascals", "Pa"],
    ["partsPerMillion", "ppm"],
    ["percent", "%"],
    ["RPM", "rpm"],
    ["voltAmperes", "VA"],
    ["millimeters", "mm"],
    ["minutes", "min"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeSIUnit(input), expected, `${input} -> ${expected}`);
  }
});
