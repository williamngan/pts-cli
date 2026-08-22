window.demoDescription = "Classic async completion fixture";

(async function () {
  Pts.quickStart("#pt", "#000000");
  await Promise.resolve();
  space.add(function () {
    form.fillOnly("#ffff00").rect([
      [0, 0],
      [18, 12],
    ]);
  });
  space.play();
})();
