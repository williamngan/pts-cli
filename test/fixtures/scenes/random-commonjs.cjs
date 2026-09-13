module.exports = {
  width: 8,
  height: 6,
  async run({ Pts, params }) {
    const namespace = params.dynamicImport ? await import("pts") : Pts;
    if (namespace.Num !== Pts.Num) throw new Error("Mismatched Pts namespace");
    if (params.noise) Math.random();
    console.log(
      JSON.stringify({
        pts: [namespace.Num.random(), namespace.Num.random()],
        math: Math.random(),
      }),
    );
  },
};
