export default function run({ space, form }) {
  space.add(() => {
    form.fillOnly("#7566ff").point(space.center, 1, "circle");
  });
}
