const { Num } = require("pts");
module.exports = {
  run() {
    throw new Error(
      "This scene must be rejected before execution: " + Num.random(),
    );
  },
};
