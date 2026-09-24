// Loaded by `npm run lint` and by the pre-commit eslint hook, which runs the repo's own eslint from
// node_modules (see .pre-commit-config.yaml) so both share one environment. The rules themselves
// are shared by every BBQS app and live in @brain-bbqs/config.
import path from "node:path";
import { createEslintConfig } from "@brain-bbqs/config/eslint";

export default createEslintConfig({
  tsconfigRootDir: path.resolve(import.meta.dirname, ".."),
});
