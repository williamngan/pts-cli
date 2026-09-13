export default {
  width: 120,
  height: 40,
  run({ space, form }) {
    space.add(() => {
      form
        .fillOnly("#123456")
        .font(16, "normal", "normal", 1.2, "Pts Render Configured Font")
        .text([5, 24], "portable font");
    });
  },
};
