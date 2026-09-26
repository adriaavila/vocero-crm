import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // JSX con el runtime automático, como lo compila Next: sin esto, renderizar
  // un componente en un test falla con "React is not defined".
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
