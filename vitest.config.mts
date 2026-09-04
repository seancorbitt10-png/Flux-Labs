import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(root, ".env") });
dotenv.config({ path: path.resolve(root, ".env.local"), override: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
});
