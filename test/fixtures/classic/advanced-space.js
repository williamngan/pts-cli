// Minimal fixture matching advanced demos that construct CanvasSpace directly.
window.demoDescription = "Classic advanced CanvasSpace fixture";

(function () {
  Pts.namespace(this);
  var ready = false;
  var advanced = new CanvasSpace("#pt", function (bound, canvas) {
    ready = bound.width === 18 && canvas.width === 18;
  });

  advanced
    .setup({ bgcolor: "#221100", resize: true, retina: true })
    .add(function () {
      form.fillOnly(ready ? "#0000ff" : "#ff0000").rect([
        [0, 0],
        [18, 12],
      ]);
    })
    .bindMouse()
    .bindTouch()
    .play();
})();
