export default {
  width: 8,
  height: 6,
  run({ space, form }) {
    space.add({
      resize() {
        console.log(JSON.stringify(["resize", space.width, space.height]));
      },
      action(type, x, y, event) {
        console.log(JSON.stringify([type, x, y, event.timeStamp]));
      },
      animate(time, delta) {
        console.log(
          JSON.stringify(["frame", time, delta, ...space.pointer.toArray()]),
        );
        form.fillOnly("#ff0000").point(space.pointer, 1, "square");
      },
    });
    return () => {
      console.log(JSON.stringify(["cleanup"]));
    };
  },
};
