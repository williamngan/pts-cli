export default {
  width: 16,
  height: 12,
  background: "#000000",
  assetBaseURL: import.meta.url,

  async run({ space, form, assets }) {
    const image = await assets.image("../assets/square.svg");
    space.add(() =>
      form.image(
        [
          [4, 2],
          [12, 10],
        ],
        image,
      ),
    );
  },
};
