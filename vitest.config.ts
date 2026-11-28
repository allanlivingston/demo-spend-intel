import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // tsconfig keeps JSX as-is for Next ("preserve"); tests need it compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["src/**/*.test.ts"] },
});
