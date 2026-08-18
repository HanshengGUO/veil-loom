import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  isLoomAcceptedCommandResponse,
  isLoomBacktestView,
  isLoomBlobRecord,
  isLoomEventEnvelope,
  isLoomExperimentEvidenceResponse,
  isLoomProjectExperimentsResponse,
  isLoomProjectReadinessResponse,
  isLoomPromotionAcceptedResponse,
  isLoomSelectionCreatedPayload,
  isLoomVeilExperimentRecordedPayload,
  isLoomVeilReproductionCompletedPayload,
} from "@veilquant/loom-protocol";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DAEMON_ENTRY = join(REPOSITORY_ROOT, "apps", "daemon", "dist", "index.js");
const NEXT_ENTRY = join(REPOSITORY_ROOT, "node_modules", "next", "dist", "bin", "next");
const EXAMPLE_ROOT = join(REPOSITORY_ROOT, "examples", "daily-factor");
const WEB_ROOT = join(REPOSITORY_ROOT, "apps", "web");
const LOOPBACK = "127.0.0.1";
const PROJECT_ID = "daily-factor";
const TERMINAL_EVENTS = new Set([
  "task.cancelled",
  "task.completed",
  "task.failed",
  "task.interrupted",
]);
const FIXTURE_INPUTS = [
  ".veil/project.yaml",
  "adapter.yaml",
  "artifact/daily-factor.mjs",
  "factor.ts",
  "market.csv",
  "reference-import.json",
  "veil-prices.csv",
];

async function main() {
  await requireBuiltProduct();
  const temporaryRoot = await mkdtemp(join(tmpdir(), "veil-loom-clean-machine-"));
  const projectRoot = join(temporaryRoot, "project");
  const stateRoot = join(temporaryRoot, "state");
  let daemon;
  let web;
  try {
    await cp(EXAMPLE_ROOT, projectRoot, { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    const sourceDigests = await fixtureDigests(projectRoot);
    const daemonPort = await availablePort();
    let webPort = await availablePort();
    while (webPort === daemonPort) webPort = await availablePort();
    const daemonOrigin = `http://${LOOPBACK}:${daemonPort}`;
    const webOrigin = `http://${LOOPBACK}:${webPort}`;

    web = startService({
      label: "Web app",
      args: [NEXT_ENTRY, "start", "--hostname", LOOPBACK, "--port", String(webPort)],
      cwd: WEB_ROOT,
      environment: cleanEnvironment({ NEXT_TELEMETRY_DISABLED: "1" }),
    });
    const html = await waitForHttp(web, webOrigin);
    assert(html.includes("Veil Loom"), "The production Web app did not render its product shell");

    daemon = startDaemon({ daemonPort, projectRoot, stateRoot, webOrigin });
    await waitForHttp(daemon, `${daemonOrigin}/v0/health`);
    const client = new DaemonClient(daemonOrigin, webOrigin);
    await client.bootstrap();

    const readiness = (await client.request("GET", `/v0/projects/${PROJECT_ID}`)).body;
    assert(
      isLoomProjectReadinessResponse(readiness) && readiness.status === "ready",
      "The copied Veil project was not ready",
    );

    const created = (
      await client.request("POST", `/v0/projects/${PROJECT_ID}/sessions`, {
        format: "loom.session.create.v0",
        profile: "raw-pi",
      })
    ).body;
    assert(isLoomAcceptedCommandResponse(created), "The Raw session receipt was invalid");
    const rawSessionId = created.sessionId;

    const initialMessage = (
      await client.request(
        "POST",
        `/v0/sessions/${encodeURIComponent(rawSessionId)}/messages?projectId=${PROJECT_ID}`,
        {
          format: "loom.message.send.v0",
          content: "Publish the committed daily-factor view.",
        },
      )
    ).body;
    assertAcceptedTask(initialMessage, "The initial Raw task receipt was invalid");
    const initialRun = await waitForTask(client, rawSessionId, initialMessage.taskId);
    assert(initialRun.terminal.type === "task.completed", "The initial Raw task did not complete");
    const published = initialRun.events.find((event) => event.type === "view.published");
    assert(typeof published?.payload.viewId === "string", "The Raw task published no view");
    const viewId = published.payload.viewId;

    const view = (
      await client.request(
        "GET",
        `/v0/views/${encodeURIComponent(viewId)}?${query({ projectId: PROJECT_ID, sessionId: rawSessionId })}`,
      )
    ).body;
    assert(isLoomBacktestView(view), "The published backtest view was invalid");
    assert(
      view.assurance.state === "exploratory" && view.assurance.issuer === "loom",
      "The Raw view crossed the assurance boundary",
    );
    const references = [view.market, view.equity, view.drawdown, view.trades].filter(
      (reference) => reference !== null,
    );
    assert(references.length === 4, "The reference view did not expose all four chart resources");
    for (const reference of references) {
      const blob = (
        await client.request(
          "GET",
          `/v0/blobs/${encodeURIComponent(reference.blobId)}?${query({
            projectId: PROJECT_ID,
            sessionId: rawSessionId,
            viewId,
          })}`,
        )
      ).body;
      assert(
        isLoomBlobRecord(blob) && blob.blobId === reference.blobId,
        `The ${reference.key} chart resource was invalid`,
      );
    }

    const selectionReceipt = (
      await client.request(
        "POST",
        `/v0/sessions/${encodeURIComponent(rawSessionId)}/selections?projectId=${PROJECT_ID}`,
        {
          format: "loom.selection.create.v0",
          viewId,
          from: view.timeRange.start,
          until: view.timeRange.end,
          seriesKeys: ["market", "equity", "drawdown", "trades"],
        },
      )
    ).body;
    assert(
      isLoomAcceptedCommandResponse(selectionReceipt) &&
        typeof selectionReceipt.selectionId === "string",
      "The selection receipt was invalid",
    );
    const selectionId = selectionReceipt.selectionId;
    const selectionEvent = (await sessionEvents(client, rawSessionId)).find(
      (event) =>
        event.type === "selection.created" &&
        event.payload.commandId === selectionReceipt.commandId,
    );
    assert(
      isLoomSelectionCreatedPayload(selectionEvent?.payload) &&
        selectionEvent.payload.selection.selectionId === selectionId,
      "The selection was not durably projected",
    );

    const selectionMessage = (
      await client.request(
        "POST",
        `/v0/sessions/${encodeURIComponent(rawSessionId)}/messages?projectId=${PROJECT_ID}`,
        {
          format: "loom.message.send.v0",
          content: "Review this selected range.",
          selectionId,
        },
      )
    ).body;
    assertAcceptedTask(selectionMessage, "The selection-grounded task receipt was invalid");
    const selectionRun = await waitForTask(client, rawSessionId, selectionMessage.taskId);
    assert(
      selectionRun.terminal.type === "task.completed",
      "The selection-grounded Raw task did not complete",
    );
    const rawBeforePromotion = JSON.stringify(selectionRun.events);

    const promotion = (
      await client.request(
        "POST",
        `/v0/sessions/${encodeURIComponent(rawSessionId)}/promotions?projectId=${PROJECT_ID}`,
        {
          format: "loom.promotion.create.v0",
          viewId,
          artifactReference: "artifact/daily-factor.mjs",
          hypothesis: {
            statement:
              "The strongest cross-sectional price trend remains positive out of sample after costs.",
          },
        },
      )
    ).body;
    assert(isLoomPromotionAcceptedResponse(promotion), "The promotion receipt was invalid");
    const promotionRun = await waitForTask(client, promotion.sessionId, promotion.taskId);
    assert(promotionRun.terminal.type === "task.completed", "The Veil promotion did not complete");
    assert(
      JSON.stringify(await sessionEvents(client, rawSessionId)) === rawBeforePromotion,
      "Promotion mutated the Raw source event log",
    );
    const experimentEvent = promotionRun.events.find(
      (event) =>
        event.type === "veil.experiment_recorded" &&
        isLoomVeilExperimentRecordedPayload(event.payload),
    );
    assert(
      experimentEvent !== undefined && isLoomVeilExperimentRecordedPayload(experimentEvent.payload),
      "Promotion produced no verified Experiment record",
    );
    const experimentId = experimentEvent.payload.experimentId;
    const originalVerdict = experimentEvent.payload.verdict;

    const rawBeforeRestart = await sessionEvents(client, rawSessionId);
    const targetBeforeRestart = await sessionEvents(client, promotion.sessionId);
    const oldCookie = client.cookie;
    await stopService(daemon);
    daemon = startDaemon({ daemonPort, projectRoot, stateRoot, webOrigin });
    await waitForHttp(daemon, `${daemonOrigin}/v0/health`);

    const stale = await fetch(`${daemonOrigin}/v0/capabilities`, {
      headers: { Origin: webOrigin, Cookie: oldCookie },
      redirect: "error",
    });
    assert(stale.status === 401, "Daemon restart did not rotate the browser session credential");
    await stale.arrayBuffer();
    await client.bootstrap();
    assertEventPrefix(await sessionEvents(client, rawSessionId), rawBeforeRestart, "Raw session");
    assertEventPrefix(
      await sessionEvents(client, promotion.sessionId),
      targetBeforeRestart,
      "Veil session",
    );

    const history = (await client.request("GET", `/v0/projects/${PROJECT_ID}/experiments`)).body;
    assert(
      isLoomProjectExperimentsResponse(history) &&
        history.experiments.some(
          (item) => item.sessionId === promotion.sessionId && item.experimentId === experimentId,
        ),
      "The project Experiment index did not recover",
    );
    const evidenceResponse = await client.request(
      "GET",
      `/v0/sessions/${encodeURIComponent(promotion.sessionId)}/experiments/${encodeURIComponent(
        experimentId,
      )}?projectId=${PROJECT_ID}`,
    );
    const evidence = evidenceResponse.body;
    assert(
      isLoomExperimentEvidenceResponse(evidence) &&
        evidence.experimentId === experimentId &&
        evidence.verdict === originalVerdict,
      "The recovered Experiment evidence was invalid",
    );
    assert(
      evidenceResponse.response.headers.get("cache-control")?.includes("immutable"),
      "The Experiment evidence lost its immutable cache identity",
    );

    const recoveredMessage = (
      await client.request(
        "POST",
        `/v0/sessions/${encodeURIComponent(rawSessionId)}/messages?projectId=${PROJECT_ID}`,
        {
          format: "loom.message.send.v0",
          content: "Confirm the selected range remains available after restart.",
          selectionId,
        },
      )
    ).body;
    assertAcceptedTask(recoveredMessage, "The recovered Raw session rejected its selection");
    const recoveredRun = await waitForTask(client, rawSessionId, recoveredMessage.taskId);
    assert(
      recoveredRun.terminal.type === "task.completed",
      "The recovered Raw task did not complete",
    );

    const reproduction = (
      await client.request(
        "POST",
        `/v0/sessions/${encodeURIComponent(promotion.sessionId)}/experiments/${encodeURIComponent(
          experimentId,
        )}/reproductions?projectId=${PROJECT_ID}`,
        { format: "loom.experiment.reproduce.v0" },
      )
    ).body;
    assertAcceptedTask(reproduction, "The reproduction receipt was invalid");
    const reproductionRun = await waitForTask(client, promotion.sessionId, reproduction.taskId);
    assert(
      reproductionRun.terminal.type === "task.completed",
      "The Experiment reproduction did not complete",
    );
    const reproduced = reproductionRun.events.find(
      (event) =>
        event.type === "veil.reproduction_completed" &&
        event.payload.taskId === reproduction.taskId,
    );
    assert(
      isLoomVeilReproductionCompletedPayload(reproduced?.payload) &&
        reproduced.payload.experimentId === experimentId &&
        reproduced.payload.reproducedExperimentId === experimentId &&
        reproduced.payload.pricingHash === evidence.lineage.pricingHash &&
        reproduced.payload.gateEvaluationHash === evidence.lineage.gateEvaluationHash,
      "The reproduction did not match the archived identities",
    );
    const originalAfterReproduction = reproductionRun.events.find(
      (event) => event.type === "veil.experiment_recorded",
    );
    assert(
      originalAfterReproduction?.payload.verdict === originalVerdict,
      "Reproduction changed the original Experiment verdict",
    );

    const projection = JSON.stringify({ history, evidence, events: reproductionRun.events });
    for (const forbidden of [
      temporaryRoot,
      "contentBase64",
      "sourceLocator",
      "veil-prices.csv",
      ".veil/experiments",
    ]) {
      assert(!projection.includes(forbidden), `The public projection exposed ${forbidden}`);
    }
    assert(
      JSON.stringify(await fixtureDigests(projectRoot)) === JSON.stringify(sourceDigests),
      "The acceptance flow changed a committed fixture input",
    );

    process.stdout.write(
      `${[
        "Clean-machine acceptance passed",
        `platform=${process.platform}`,
        `node=${process.versions.node}`,
        `rawEvents=${recoveredRun.events.length}`,
        `targetEvents=${reproductionRun.events.length}`,
        `executionCount=${experimentEvent.payload.executionCount}`,
        `metrics=${evidence.metrics.length}`,
        `gates=${evidence.gates.length}`,
        `snapshots=${evidence.lineage.readSetSnapshotCount}`,
        `verdict=${originalVerdict}`,
        `reproduction=${reproduced.payload.status}`,
      ].join(" ")}\n`,
    );
  } finally {
    await stopService(daemon);
    await stopService(web);
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

class DaemonClient {
  constructor(origin, webOrigin) {
    this.origin = origin;
    this.webOrigin = webOrigin;
    this.cookie = "";
  }

  async bootstrap() {
    const response = await fetch(`${this.origin}/v0/auth/bootstrap`, {
      method: "POST",
      headers: { Origin: this.webOrigin },
      redirect: "error",
    });
    assert(response.status === 200, `Daemon bootstrap returned ${response.status}`);
    this.cookie = (response.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
    assert(this.cookie.length > 0, "Daemon bootstrap returned no session cookie");
  }

  async request(method, path, body) {
    assert(this.cookie.length > 0, "The daemon client is not authenticated");
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: {
        Origin: this.webOrigin,
        Cookie: this.cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
    });
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`Daemon returned malformed JSON with status ${response.status}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new Error(`Daemon request returned ${response.status}: ${JSON.stringify(value)}`);
    }
    return { response, body: value };
  }
}

function startDaemon({ daemonPort, projectRoot, stateRoot, webOrigin }) {
  return startService({
    label: "Loom daemon",
    args: [DAEMON_ENTRY],
    cwd: projectRoot,
    environment: cleanEnvironment({
      LOOM_DAEMON_PORT: String(daemonPort),
      LOOM_PROJECT_ID: PROJECT_ID,
      LOOM_STATE_DIR: stateRoot,
      LOOM_WEB_ORIGIN: webOrigin,
    }),
  });
}

function startService({ label, args, cwd, environment }) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const handle = {
    label,
    child,
    output: "",
    exited: false,
    result: undefined,
    spawnError: undefined,
    exit: undefined,
  };
  const append = (chunk) => {
    handle.output = `${handle.output}${String(chunk)}`.slice(-65_536);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.once("error", (error) => {
    handle.spawnError = error;
  });
  handle.exit = new Promise((resolveExit) => {
    child.once("close", (code, signal) => {
      handle.exited = true;
      handle.result = { code, signal };
      resolveExit(handle.result);
    });
  });
  return handle;
}

async function stopService(handle) {
  if (handle === undefined || handle.exited) return;
  handle.child.kill("SIGTERM");
  await waitForExit(handle, 5_000);
  if (!handle.exited) {
    handle.child.kill("SIGKILL");
    await waitForExit(handle, 5_000);
  }
  assert(handle.exited, `${handle.label} did not stop`);
}

async function waitForExit(handle, timeoutMs) {
  if (handle.exited) return;
  await Promise.race([
    handle.exit,
    new Promise((resolveTimeout) => {
      const timeout = setTimeout(resolveTimeout, timeoutMs);
      timeout.unref();
    }),
  ]);
}

async function waitForHttp(handle, url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (handle.spawnError !== undefined || handle.exited) throw serviceFailure(handle);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 200) return await response.text();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${handle.label} did not become ready`, { cause: lastError });
}

function serviceFailure(handle) {
  return new Error(
    `${handle.label} exited before readiness (${JSON.stringify(handle.result)}): ${handle.output}`,
    handle.spawnError === undefined ? undefined : { cause: handle.spawnError },
  );
}

async function sessionEvents(client, sessionId) {
  const response = (
    await client.request(
      "GET",
      `/v0/sessions/${encodeURIComponent(sessionId)}/events?projectId=${PROJECT_ID}`,
    )
  ).body;
  assert(
    response?.format === "loom.events.v0" &&
      Array.isArray(response.events) &&
      response.events.every(isLoomEventEnvelope),
    `Session ${sessionId} returned invalid events`,
  );
  return response.events;
}

async function waitForTask(client, sessionId, taskId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const events = await sessionEvents(client, sessionId);
    const terminal = events.find(
      (event) => TERMINAL_EVENTS.has(event.type) && event.payload.taskId === taskId,
    );
    if (terminal !== undefined) return { events, terminal };
    await delay(200);
  }
  throw new Error(`Task ${taskId} did not reach a terminal state`);
}

function assertAcceptedTask(input, message) {
  assert(isLoomAcceptedCommandResponse(input) && typeof input.taskId === "string", message);
}

function assertEventPrefix(actual, expected, label) {
  assert(actual.length >= expected.length, `${label} lost durable events after restart`);
  assert(
    JSON.stringify(actual.slice(0, expected.length)) === JSON.stringify(expected),
    `${label} changed durable history after restart`,
  );
}

async function requireBuiltProduct() {
  for (const path of [DAEMON_ENTRY, NEXT_ENTRY, join(WEB_ROOT, ".next", "BUILD_ID")]) {
    try {
      const metadata = await stat(path);
      assert(metadata.isFile(), `Expected a built file at ${path}`);
    } catch (error) {
      throw new Error("Build Veil Loom before running built-product acceptance", { cause: error });
    }
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, LOOPBACK, resolveListen);
  });
  const address = server.address();
  assert(address !== null && typeof address === "object", "Could not allocate a loopback port");
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
  return address.port;
}

function cleanEnvironment(overrides) {
  const allowed = new Set([
    "CI",
    "COMSPEC",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ",
    "USERPROFILE",
    "WINDIR",
  ]);
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) environment[key] = value;
  }
  return { ...environment, ...overrides };
}

async function fixtureDigests(root) {
  const entries = await Promise.all(
    FIXTURE_INPUTS.map(async (reference) => {
      const bytes = await readFile(join(root, ...reference.split("/")));
      return [reference, createHash("sha256").update(bytes).digest("hex")];
    }),
  );
  return Object.fromEntries(entries);
}

function query(values) {
  return new URLSearchParams(values).toString();
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

await main();
