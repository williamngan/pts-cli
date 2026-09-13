export default {
  apiVersion: 1,
  name: "Portable card fixture",
  width: 96,
  height: 64,
  background: "#10131a",
  metadata: { fixture: true },

  run({ Pts, space, form, params }) {
    const { Circle } = Pts;
    console.log("portable-card run");

    space.add({
      animate(time) {
        const radius = Number(params.radius ?? 12) + time / 100;
        form
          .fillOnly("#67e8f9")
          .circle(Circle.fromCenter(space.pointer, radius))
          .fillOnly("#f8fafc")
          .font(10, "bold")
          .text([4, 58], "Pts Render");
      },
    });
  },
};
