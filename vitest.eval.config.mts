import { defineConfig } from "vitest/config";

// The golden-set evaluation (npm run eval). Kept apart from `npm test`
// because it calls real models and takes a minute or two.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 600_000,
    // Print the results table straight to the terminal.
    disableConsoleIntercept: true,
  },
});
