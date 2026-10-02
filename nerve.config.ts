import { defineConfig } from "@grayhaven/nerve"

export default defineConfig({
  units: "mm",
  entry: "./src/main.harness.ts",
  defaultWireTolerance: 10,
  outputDir: "dist",
  rules: {
    missingWireColor: "error",
    missingWireLength: "warning"
  },
  exports: { csv: true, svg: true }
})
