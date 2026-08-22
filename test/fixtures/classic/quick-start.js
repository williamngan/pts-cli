// Minimal fixture matching the public shape of Pts standard demos.
window.demoDescription = "Classic quickStart fixture";

(function () {
  var run = Pts.quickStart("#pt", "#112233");
  var lifecycle = [];

  run(
    function () {
      var color =
        lifecycle.join(",") === "resize,start" ? "#00ff00" : "#ff0000";
      form.fillOnly(color).rect([
        [0, 0],
        [space.width, space.height],
      ]);
    },
    function () {
      lifecycle.push("start");
    },
    null,
    function () {
      lifecycle.push("resize");
    },
  );
})();
