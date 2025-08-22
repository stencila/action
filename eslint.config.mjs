import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import stylistic from "@stylistic/eslint-plugin";


export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["src/**/*.js", "test/**/*.js"], languageOptions: { sourceType: "module" } },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.node } },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      "@stylistic": stylistic
    },
    rules: {
      "@stylistic/semi": ["error", "always"],
      "@stylistic/quotes": ["error", "single"],
      "@stylistic/indent": ["error", 2],
      "@stylistic/comma-dangle": ["error", "only-multiline"],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/space-before-blocks": "error",
      "@stylistic/keyword-spacing": "error",
      "@stylistic/comma-spacing": "error",
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/array-bracket-spacing": ["error", "never"]
    }
  }
]);
