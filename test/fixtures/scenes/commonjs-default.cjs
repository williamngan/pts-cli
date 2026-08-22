exports.default = {
  width: 7,
  height: 5,
  setup({ space, form }) {
    space.add(() =>
      form.fillOnly("#654321").rect([
        [0, 0],
        [7, 5],
      ]),
    );
  },
};
