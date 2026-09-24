import "../../src/style.css";
import { storybookPreview } from "@brain-bbqs/config/storybook-preview";

// Spread rather than re-exported: Storybook statically parses the default export and warns unless it
// is an object literal.
export default { ...storybookPreview };
