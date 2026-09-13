import { Num } from "pts";

export default {
  width: 8,
  height: 6,
  run({ Pts, params }) {
    if (Num !== Pts.Num) throw new Error("Mismatched Pts namespace");
    if (params.noise) Math.random();
    console.log(
      JSON.stringify({
        pts: [Num.random(), Num.random()],
        math: Math.random(),
      }),
    );
  },
};
