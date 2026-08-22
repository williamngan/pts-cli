export default {
  apiVersion: 1,
  name: "Basic Pts card",
  width: 1200,
  height: 630,
  background: "#10131a",
  assetBaseURL: import.meta.url,

  setup({ Pts, space, form }) {
    const { Circle, Pt } = Pts;

    space.add((_time, _delta, current) => {
      const halo = form.gradient(["#67e8f9", "#8b5cf6"]);

      form
        .fillOnly(
          halo(
            Circle.fromCenter(current.center, 190),
            Circle.fromCenter(current.center, 30),
          ),
        )
        .circle(Circle.fromCenter(current.center, 190))
        .fillOnly("#10131a")
        .circle(Circle.fromCenter(current.center, 145))
        .fillOnly("#f8fafc")
        .font(54, "bold", undefined, 1.2, "sans-serif")
        .text(new Pt(72, 548), "Pts + Skia Canvas");
    });
  },
};
