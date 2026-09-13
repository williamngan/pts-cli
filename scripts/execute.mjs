import spawn from "cross-spawn";

// cross-spawn resolves .cmd shims and quotes arguments on Windows as well as
// executable files on Unix. No caller-supplied command string is evaluated.
export function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0)
        reject(
          new Error(
            command + " failed (" + (signal ?? code) + ")\n" + stdout + stderr,
          ),
        );
      else resolve({ stdout, stderr });
    });
  });
}
