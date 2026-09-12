module.exports = {
  width: 7,
  height: 5,
  run({ space, form }) {
    space.add(() =>
      form.fillOnly("#123456").rect([
        [0, 0],
        [7, 5],
      ]),
    );
  },
};
