import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const protocol = fileURLToPath(new URL("../../packages/phone-protocol/src/", import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^@openmausbot\/phone-protocol\/(.*)$/, replacement: `${protocol}$1` }] },
  server: { fs: { allow: ["../.."] } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
