import "../../src/style.css";

const preview = {
  parameters: {
    backgrounds: {
      // Matches the app's light-theme --bg so the story renders on the page's real background.
      default: "app",
      values: [{ name: "app", value: "#f6f7fb" }],
    },
  },
};

export default preview;
