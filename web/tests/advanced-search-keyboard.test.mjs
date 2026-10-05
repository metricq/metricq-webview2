import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup() {
  const events = [];
  let open = false;
  let focused = null;
  let hides = 0;
  const added = [];
  const element = () => ({
    addEventListener(type, handler, options) { events.push({ target: this, type, handler, options }); },
    classList: { contains: () => open, add() {}, remove() {}, toggle() {} },
    focus() { focused = this; },
    setAttribute() {},
  });
  const elements = {};
  const dom = new Proxy(elements, { get: (target, name) => target[name] ||= element() });
  const document = element();
  const context = vm.createContext({
    dom, document, metricByName: () => null,
    bootstrap: { Modal: { getOrCreateInstance: () => ({ show() { open = true; }, hide() { hides++; } }) } },
  });
  const source = readFileSync(new URL("../js/advanced-search.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace("export function wireAdvancedSearch", "function wireAdvancedSearch");
  vm.runInContext(source, context);
  context.hooks = { addMetric: (name) => added.push(name) };
  vm.runInContext("wireAdvancedSearch(hooks)", context);
  const shortcut = events.find((e) => e.target === document && e.type === "keydown");
  const keydown = events.find((e) => e.target === dom.advancedSearchModal && e.type === "keydown").handler;
  const rows = Array.from({ length: 3 }, (_, index) => {
    const checkbox = { disabled: index === 1, checked: false, click() { this.checked = !this.checked; } };
    const row = element();
    row.querySelector = () => checkbox;
    row.closest = (selector) => selector === ".adv-result-item" ? row : null;
    row.scrollIntoView = () => {};
    return row;
  });
  dom.advSearchResults.querySelectorAll = () => rows;
  dom.advSearchInput.closest = () => null;
  return { dom, context, rows, shortcut, keydown, added, focused: () => focused, hides: () => hides };
}

function key(key, target, extra = {}) {
  return { key, target, preventDefault() { this.prevented = true; }, ...extra };
}

test("Ctrl+F uses capture and focuses an already open modal", () => {
  const s = setup();
  assert.equal(s.shortcut.options.capture, true);
  const first = key("f", s.dom.advSearchInput, { ctrlKey: true });
  s.shortcut.handler(first);
  assert.equal(first.prevented, true);
  const second = key("f", s.dom.advSearchInput, { ctrlKey: true });
  s.shortcut.handler(second);
  assert.equal(second.prevented, true);
  assert.equal(s.focused(), s.dom.advSearchInput);
});

test("arrows skip added metrics, Space toggles, Enter adds selection and closes", () => {
  const s = setup();
  s.keydown(key("ArrowDown", s.dom.advSearchInput));
  assert.equal(s.focused(), s.rows[0]);
  s.keydown(key("ArrowDown", s.rows[0]));
  assert.equal(s.focused(), s.rows[2]);
  s.keydown(key("ArrowUp", s.rows[2]));
  assert.equal(s.focused(), s.rows[0]);
  s.keydown(key(" ", s.rows[0]));
  assert.equal(s.rows[0].querySelector().checked, true);
  s.keydown(key(" ", s.rows[0]));
  assert.equal(s.rows[0].querySelector().checked, false);
  const typing = key(" ", s.dom.advSearchInput);
  s.keydown(typing);
  assert.equal(typing.prevented, undefined);
  vm.runInContext('selectedNames.add("chosen"); renderResults = () => {};', s.context);
  s.keydown(key("Enter", s.rows[0]));
  assert.deepEqual(s.added, ["chosen"]);
  assert.equal(s.hides(), 1);
});
