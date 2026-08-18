/**
 * skia-canvas 3.0.8 references Sharp from its declaration file even though
 * Sharp is an optional integration. This internal shim lets this package check
 * its implementation without turning Sharp into a runtime dependency.
 *
 * Public declarations deliberately avoid importing skia-canvas types.
 */
declare module "sharp" {
  export type Sharp = object;
}
