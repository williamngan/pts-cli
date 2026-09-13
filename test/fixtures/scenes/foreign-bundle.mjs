import { Num } from "pts/dist/index.js";
export default {
  run() {
    throw new Error(
      "This scene must be rejected before execution: " + Num.random(),
    );
  },
};
