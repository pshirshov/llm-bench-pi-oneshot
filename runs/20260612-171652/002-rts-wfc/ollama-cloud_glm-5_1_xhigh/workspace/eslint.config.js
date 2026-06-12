import tseslint from "typescript-eslint";

const PRNG_FILE = "src/sim/prng.ts";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-restricted-properties": [
        "error",
        {
          "object": "Math",
          "property": "random",
          "message": "Use the seeded PRNG from src/sim/prng.ts instead of Math.random."
        }
      ],
      "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: [PRNG_FILE],
    rules: {
      "no-restricted-properties": "off",
    },
  },
);