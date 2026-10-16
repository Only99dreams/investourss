import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { itemsToText } from "./pdfText.ts";

test("rebuilds a PDF row with a space between every table column", () => {
  const items = [
    { str: "06/08/2026", transform: [1, 0, 0, 10, 40, 700], width: 55, height: 10 },
    { str: "POS PURCHASE", transform: [1, 0, 0, 10, 110, 700], width: 90, height: 10 },
    { str: "10,000.00", transform: [1, 0, 0, 10, 330, 700], width: 50, height: 10 },
    { str: "690,000.00", transform: [1, 0, 0, 10, 400, 700], width: 60, height: 10, hasEOL: true },
    { str: "07/08/2026", transform: [1, 0, 0, 10, 40, 690], width: 55, height: 10 },
    { str: "SALARY", transform: [1, 0, 0, 10, 110, 690], width: 40, height: 10 },
    { str: "250,000.00", transform: [1, 0, 0, 10, 330, 690], width: 50, height: 10, hasEOL: true },
  ];

  assert.equal(
    itemsToText(items),
    "06/08/2026 POS PURCHASE 10,000.00 690,000.00\n07/08/2026 SALARY 250,000.00",
  );
});

test("keeps runs that continue the same word glued together", () => {
  const items = [
    { str: "5,00", transform: [1, 0, 0, 10, 100, 700], width: 20, height: 10 },
    { str: "0.00", transform: [1, 0, 0, 10, 120.2, 700], width: 20, height: 10 },
  ];

  assert.equal(itemsToText(items), "5,000.00");
});

test("orders rows top-to-bottom and items left-to-right", () => {
  const items = [
    { str: "B", transform: [1, 0, 0, 10, 200, 600], width: 10, height: 10 },
    { str: "A", transform: [1, 0, 0, 10, 40, 600], width: 10, height: 10 },
    { str: "SECOND", transform: [1, 0, 0, 10, 40, 700], width: 40, height: 10 },
  ];

  assert.equal(itemsToText(items), "SECOND\nA B");
});

test("returns an empty string for no usable items", () => {
  assert.equal(itemsToText([]), "");
  assert.equal(itemsToText([{ str: "" }, {}]), "");
});

test("index.ts inlines an identical copy of itemsToText", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const marked = (source) => {
    const start = source.indexOf("// >>> itemsToText");
    const end = source.indexOf("// <<< itemsToText");
    assert.ok(start !== -1 && end > start, "itemsToText markers are missing");
    // Compare ignoring whitespace so CRLF vs LF and formatting do not matter.
    return source.slice(start, end).replace(/\s+/g, " ").trim();
  };

  const module = marked(readFileSync(join(here, "pdfText.ts"), "utf8"));
  const edgeFunction = marked(readFileSync(join(here, "index.ts"), "utf8"));

  assert.equal(
    edgeFunction,
    module,
    "index.ts and pdfText.ts copies of itemsToText have drifted apart — update both",
  );
});
