import { PtsRenderError, serializePtsRenderError } from "./PtsRenderError.js";
import { runWorkerJob } from "./runWorkerJob.js";
import type {
  ParentToWorkerMessage,
  WorkerToParentMessage,
} from "./workerProtocol.js";

let handled = false;

function send(message: WorkerToParentMessage): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve();
      return;
    }
    process.send(message, () => resolve());
  });
}

process.on("message", (value: unknown) => {
  if (handled) return;
  handled = true;

  void (async () => {
    try {
      const message = value as Partial<ParentToWorkerMessage>;
      if (message.type !== "render" || message.job === undefined) {
        throw new PtsRenderError(
          "WORKER_FAILED",
          "arguments",
          "Render worker received an invalid job message",
        );
      }
      const result = await runWorkerJob(message.job);
      await send({ type: "success", result });
    } catch (error) {
      await send({
        type: "failure",
        error: serializePtsRenderError(error, true),
      });
      process.exitCode = 1;
    } finally {
      if (process.connected) process.disconnect();
    }
  })();
});
