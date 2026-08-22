import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";

import { renderScene } from "../dist/index.mjs";

const executeFile = promisify(execFile);
const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(projectRoot, "compatibility/pts-revamp.json");
const manifestDirectory = dirname(manifestPath);

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function hasGitCheckout(root) {
  try {
    await stat(join(root, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function gitOutput(root, args) {
  const result = await executeFile("git", ["-C", root, ...args], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout;
}

async function gitFingerprint(root) {
  const status = await gitOutput(root, ["status", "--porcelain=v1", "-z"]);
  const diff = await gitOutput(root, ["diff", "--no-ext-diff"]);
  return {
    status: sha256(status),
    diff: sha256(diff),
  };
}

async function loadEvents(relativePath) {
  if (relativePath === undefined) return undefined;
  const value = JSON.parse(
    await readFile(join(manifestDirectory, relativePath), "utf8"),
  );
  if (
    value === null ||
    typeof value !== "object" ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.events)
  ) {
    fail("Invalid compatibility event fixture: " + relativePath);
  }
  return value.events;
}

function renderOptions(root, entry, outputDirectory, demoName, events) {
  const [width, height] = entry.fixture.size;
  const outputs = entry.formats.map((format) => ({
    format,
    path: join(outputDirectory, demoName + "." + format),
    ...(format === "svg" ? { textMode: "preserve" } : {}),
  }));
  return {
    loader: "auto",
    size: { width, height },
    pointer: entry.fixture.pointer,
    render: {
      mode: "frame",
      frame: entry.fixture.frame,
      fps: entry.fixture.fps,
    },
    seed: entry.fixture.seed,
    ...(entry.assetRoot === undefined
      ? {}
      : { assetRoot: join(root, entry.assetRoot) }),
    ...(events === undefined ? {} : { events }),
    outputs,
  };
}

async function verifyEncodedOutput(output) {
  if (output.path === undefined || output.bytes < 100) {
    fail("Compatibility output is missing or implausibly small");
  }
  const bytes = await readFile(output.path);
  if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256) {
    fail("Compatibility output facts do not match the written artifact");
  }
  if (
    output.format === "png" &&
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    fail("Compatibility PNG does not have a PNG signature");
  }
  if (
    output.format === "svg" &&
    !bytes.subarray(0, 1024).toString("utf8").includes("<svg")
  ) {
    fail("Compatibility SVG does not contain an SVG root");
  }
}

async function verifySupported(root, outputDirectory, demoName, entry) {
  const events = await loadEvents(entry.events);
  const result = await renderScene(
    join(root, "demo", demoName),
    renderOptions(root, entry, outputDirectory, demoName, events),
  );
  if (result.loader !== "pts-demo") {
    fail(demoName + " was not auto-detected as a classic Pts demo");
  }
  const warningCodes = result.warnings.map((warning) => warning.code);
  if (JSON.stringify(warningCodes) !== JSON.stringify(entry.warningCodes)) {
    fail(
      demoName +
        " warning mismatch: expected " +
        JSON.stringify(entry.warningCodes) +
        ", received " +
        JSON.stringify(warningCodes),
    );
  }
  if (result.outputs.length !== entry.formats.length) {
    fail(demoName + " returned an unexpected output count");
  }
  await Promise.all(result.outputs.map(verifyEncodedOutput));
}

async function verifyUnsupported(root, outputDirectory, demoName, entry) {
  const events = await loadEvents(entry.events);
  let caught;
  try {
    await renderScene(join(root, "demo", demoName), {
      loader: "auto",
      size: { width: 320, height: 200 },
      render: { mode: "direct", time: 0 },
      ...(events === undefined ? {} : { events }),
      outputs: [
        { format: "png", path: join(outputDirectory, demoName + ".png") },
      ],
    });
  } catch (error) {
    caught = error;
  }
  if (caught?.code !== entry.expectedErrorCode) {
    fail(
      demoName +
        " expected " +
        entry.expectedErrorCode +
        ", received " +
        String(caught?.code ?? "success"),
    );
  }
}

async function main() {
  const rootArgument = process.argv[2] ?? process.env.PTS_COMPAT_ROOT;
  if (!rootArgument) {
    fail(
      "Pass a detached Pts checkout as the first argument or PTS_COMPAT_ROOT",
    );
  }
  const root = await realpath(resolve(rootArgument));
  const installedPtsRoot = await realpath(
    dirname(require.resolve("pts/package.json")),
  );
  if (installedPtsRoot !== root) {
    fail(
      "node_modules/pts must resolve to the exact checkout under test: " + root,
    );
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageMetadata = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  if (packageMetadata.version !== manifest.pts.version) {
    fail("Pts package version does not match the compatibility manifest");
  }

  const isGitCheckout = await hasGitCheckout(root);
  let beforeFingerprint;
  if (isGitCheckout) {
    const head = (await gitOutput(root, ["rev-parse", "HEAD"]))
      .toString("utf8")
      .trim();
    if (head !== manifest.pts.commit) {
      fail("Pts checkout is at " + head + ", expected " + manifest.pts.commit);
    }
    beforeFingerprint = await gitFingerprint(root);
  }

  const outputDirectory = await mkdtemp(join(tmpdir(), "pts-compat-"));
  const counts = Object.create(null);
  try {
    for (const [demoName, entry] of Object.entries(manifest.demos)) {
      const sourcePath = join(root, "demo", demoName);
      const beforeHash = sha256(await readFile(sourcePath));
      if (beforeHash !== entry.sourceSha256) {
        fail(demoName + " does not match its manifest source hash");
      }

      if (
        entry.status === "supported" ||
        entry.status === "supported-with-input"
      ) {
        await verifySupported(root, outputDirectory, demoName, entry);
      } else if (
        entry.status === "partial" ||
        entry.status === "unsupported" ||
        entry.status === "not-applicable"
      ) {
        await verifyUnsupported(root, outputDirectory, demoName, entry);
      } else {
        fail(demoName + " has an unknown compatibility status");
      }

      const afterHash = sha256(await readFile(sourcePath));
      if (afterHash !== beforeHash) {
        fail(demoName + " changed while its compatibility check ran");
      }
      counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      process.stdout.write("PASS " + demoName + " (" + entry.status + ")\n");
    }
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }

  if (beforeFingerprint !== undefined) {
    const afterFingerprint = await gitFingerprint(root);
    if (
      beforeFingerprint.status !== afterFingerprint.status ||
      beforeFingerprint.diff !== afterFingerprint.diff
    ) {
      fail("Pts checkout status or diff changed during compatibility tests");
    }
  }

  process.stdout.write(
    "Verified Pts " +
      manifest.pts.commit +
      ": " +
      JSON.stringify(counts) +
      "\n",
  );
}

await main();
