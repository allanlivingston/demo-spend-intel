// A store selector that builds a new array or object on every call (`?? []`, `.filter(...)`, `({ ... })`) makes React 19
// re-render forever and crash the page. Activity crashed this way while no rules were saved. Use a shared constant instead.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });

test("no store selector returns a fresh array or object", () => {
  const bad = files(join(process.cwd(), "src")).flatMap((p) =>
    readFileSync(p, "utf8").split("\n").flatMap((line, i) => {
      const sel = line.match(/use(?:Store|Ui)\(\(?\w+\)?\s*=>\s*(.*)\);?\s*$/)?.[1] ?? "";
      const fresh = /\?\?\s*(\[\]|\{\})\s*$|^\(?\{|^\[|\.(filter|map|slice|concat)\([^)]*\)\s*$/.test(sel.trim());
      return fresh ? [`${p.replace(process.cwd() + "/", "")}:${i + 1}: ${line.trim()}`] : [];
    }),
  );
  expect(bad).toEqual([]);
});
