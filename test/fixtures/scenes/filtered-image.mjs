export default {
  width: 8,
  height: 6,
  async run({ space, form, assets }) {
    const image = await assets.image(
      new URL("../assets/square.svg", import.meta.url),
    );
    space.add(() => {
      form.ctx.filter = "brightness(50%)";
      form.image(
        [
          [1, 1],
          [7, 5],
        ],
        image,
      );
      form.ctx.filter = "none";
    });
  },
};
