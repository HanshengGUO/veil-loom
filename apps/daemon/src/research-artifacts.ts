import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  isLoomBacktestView,
  isLoomBlobContent,
  isLoomBlobRecord,
  isLoomPortableId,
  LOOM_JSON_BLOB_MAX_BYTES,
  LOOM_VIEW_MAX_RECORD_BYTES,
  type LoomBacktestView,
  type LoomBlobContent,
  type LoomBlobRecord,
  type LoomBlobReference,
} from "@veilquant/loom-protocol";

export type ResearchArtifactErrorCode =
  | "INVALID_ID"
  | "IMPORT_INVALID"
  | "VIEW_NOT_FOUND"
  | "BLOB_NOT_FOUND"
  | "RESOURCE_CORRUPT"
  | "RESOURCE_TOO_LARGE"
  | "RESOURCE_WRITE_FAILED";

export class ResearchArtifactError extends Error {
  readonly code: ResearchArtifactErrorCode;

  constructor(code: ResearchArtifactErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchArtifactError";
    this.code = code;
  }
}

export interface ResearchArtifactStoreOptions {
  stateRoot: string;
}

export interface PublishBacktestViewInput {
  view: Omit<LoomBacktestView, "viewId" | "market" | "equity" | "drawdown" | "trades">;
  blobs: readonly LoomBlobContent[];
}

export interface ReadViewInput {
  projectId: string;
  sessionId: string;
  viewId: string;
}

export interface ReadBlobInput extends ReadViewInput {
  blobId: string;
}

/** Stores validated view metadata and small JSON resources under content-addressed identities. */
export class ResearchArtifactStore {
  readonly #stateRoot: string;

  constructor(options: ResearchArtifactStoreOptions) {
    this.#stateRoot = options.stateRoot;
  }

  async publishBacktestView(input: PublishBacktestViewInput): Promise<LoomBacktestView> {
    assertPortableId(input.view.provenance.projectId);
    assertPortableId(input.view.provenance.sessionId);
    assertPortableId(input.view.provenance.taskId);

    const resourceKeys = input.blobs.map(contentKey);
    const requiredKeys: readonly LoomBlobReference["key"][] = [
      "market",
      "equity",
      "drawdown",
      "trades",
    ];
    if (
      input.blobs.length !== 4 ||
      new Set(resourceKeys).size !== 4 ||
      !requiredKeys.every((key) => resourceKeys.includes(key)) ||
      input.blobs.some((content) => !isLoomBlobContent(content))
    ) {
      throw new ResearchArtifactError(
        "RESOURCE_CORRUPT",
        "The normalized backtest resources are invalid",
      );
    }
    for (const content of input.blobs) {
      if (Buffer.byteLength(canonicalJson(content)) > LOOM_JSON_BLOB_MAX_BYTES) {
        throw new ResearchArtifactError("RESOURCE_TOO_LARGE", "The JSON resource is too large");
      }
    }

    const references = new Map<string, LoomBlobReference>();
    for (const content of input.blobs) {
      const contentBytes = canonicalJson(content);
      const reference = referenceFor(
        content,
        `blob_${sha256(contentBytes)}`,
        Buffer.byteLength(contentBytes),
      );
      references.set(reference.key, reference);
    }
    const market = references.get("market");
    const equity = references.get("equity");
    const drawdown = references.get("drawdown");
    const trades = references.get("trades");
    if (
      market === undefined ||
      equity === undefined ||
      drawdown === undefined ||
      trades === undefined
    ) {
      throw new ResearchArtifactError(
        "RESOURCE_CORRUPT",
        "The normalized backtest is missing a required resource",
      );
    }

    const draft: Omit<LoomBacktestView, "viewId"> = {
      ...input.view,
      market,
      equity,
      drawdown,
      trades,
    };
    const viewId = `view_${sha256(canonicalJson(draft))}`;
    const view: LoomBacktestView = { ...draft, viewId };
    if (!isLoomBacktestView(view)) {
      throw new ResearchArtifactError(
        "RESOURCE_CORRUPT",
        "The normalized backtest view is invalid",
      );
    }
    const bytes = canonicalJson(view);
    if (Buffer.byteLength(bytes) > LOOM_VIEW_MAX_RECORD_BYTES) {
      throw new ResearchArtifactError("RESOURCE_TOO_LARGE", "The backtest view is too large");
    }
    for (const content of input.blobs) {
      const stored = await this.#putBlob(content, input.view.createdAt);
      if (stored.blobId !== references.get(stored.key)?.blobId) {
        throw new ResearchArtifactError("RESOURCE_CORRUPT", "The blob identity changed");
      }
    }
    await writeImmutable(viewPath(this.#stateRoot, view), bytes);
    return immutableSnapshot(view);
  }

  async readView(input: ReadViewInput): Promise<LoomBacktestView> {
    assertPortableId(input.projectId);
    assertPortableId(input.sessionId);
    assertContentId(input.viewId, "view_");
    const path = viewPath(this.#stateRoot, {
      viewId: input.viewId,
      provenance: { projectId: input.projectId },
    });
    const value = await readJson(path, LOOM_VIEW_MAX_RECORD_BYTES, "VIEW_NOT_FOUND");
    if (!isLoomBacktestView(value)) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "The stored view is invalid");
    }
    if (
      value.viewId !== input.viewId ||
      value.provenance.projectId !== input.projectId ||
      value.provenance.sessionId !== input.sessionId
    ) {
      throw new ResearchArtifactError("VIEW_NOT_FOUND", "The view was not found");
    }
    const { viewId: _viewId, ...draft } = value;
    if (`view_${sha256(canonicalJson(draft))}` !== value.viewId) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "The view identity does not match");
    }
    return immutableSnapshot(value);
  }

  async readBlobForView(input: ReadBlobInput): Promise<LoomBlobRecord> {
    assertContentId(input.blobId, "blob_");
    const view = await this.readView(input);
    const reference = viewReferences(view).find((candidate) => candidate.blobId === input.blobId);
    if (reference === undefined) {
      throw new ResearchArtifactError("BLOB_NOT_FOUND", "The blob was not found");
    }
    const value = await readJson(
      blobPath(this.#stateRoot, input.blobId),
      LOOM_JSON_BLOB_MAX_BYTES + LOOM_VIEW_MAX_RECORD_BYTES,
      "BLOB_NOT_FOUND",
    );
    if (!isLoomBlobRecord(value) || value.blobId !== input.blobId) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "The stored blob is invalid");
    }
    const contentBytes = canonicalJson(value.content);
    if (
      `blob_${sha256(contentBytes)}` !== value.blobId ||
      Buffer.byteLength(contentBytes) !== reference.byteLength ||
      !referenceMatchesContent(reference, value.content)
    ) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "The blob identity does not match");
    }
    return immutableSnapshot(value);
  }

  async #putBlob(content: LoomBlobContent, createdAt: string): Promise<LoomBlobReference> {
    const contentBytes = canonicalJson(content);
    const byteLength = Buffer.byteLength(contentBytes);
    if (byteLength > LOOM_JSON_BLOB_MAX_BYTES) {
      throw new ResearchArtifactError("RESOURCE_TOO_LARGE", "The JSON resource is too large");
    }
    const blobId = `blob_${sha256(contentBytes)}`;
    const path = blobPath(this.#stateRoot, blobId);
    const existing = await readJsonIfPresent(path, LOOM_JSON_BLOB_MAX_BYTES + 4_096);
    let record: LoomBlobRecord;
    if (existing === undefined) {
      record = { format: "loom.blob.v0", blobId, createdAt, content };
      if (!isLoomBlobRecord(record)) {
        throw new ResearchArtifactError("RESOURCE_CORRUPT", "The normalized resource is invalid");
      }
      try {
        await writeImmutable(path, canonicalJson(record));
      } catch (error) {
        if (!(error instanceof ResearchArtifactError) || error.code !== "RESOURCE_WRITE_FAILED") {
          throw error;
        }
        const raced = await readJsonIfPresent(path, LOOM_JSON_BLOB_MAX_BYTES + 4_096);
        if (!isLoomBlobRecord(raced)) throw error;
        record = raced;
      }
    } else {
      if (!isLoomBlobRecord(existing)) {
        throw new ResearchArtifactError("RESOURCE_CORRUPT", "The stored blob is invalid");
      }
      record = existing;
    }
    if (record.blobId !== blobId || canonicalJson(record.content) !== contentBytes) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "The blob identity is inconsistent");
    }
    return referenceFor(record.content, blobId, byteLength);
  }
}

export function canonicalJson(input: unknown): string {
  return JSON.stringify(canonicalValue(input, new WeakSet()));
}

function canonicalValue(input: unknown, ancestors: WeakSet<object>): unknown {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypeError("Canonical JSON requires finite numbers");
    return input;
  }
  if (typeof input !== "object" || ancestors.has(input)) {
    throw new TypeError("Canonical JSON requires an acyclic JSON value");
  }
  ancestors.add(input);
  try {
    if (Array.isArray(input)) return input.map((value) => canonicalValue(value, ancestors));
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON requires plain objects");
    }
    return Object.fromEntries(
      Object.entries(input)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => [key, canonicalValue(value, ancestors)]),
    );
  } finally {
    ancestors.delete(input);
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function referenceFor(
  content: LoomBlobContent,
  blobId: string,
  byteLength: number,
): LoomBlobReference {
  if (content.format === "loom.table.v0") {
    return {
      blobId,
      contentFormat: content.format,
      kind: content.kind,
      key: content.tableKey,
      itemCount: content.rows.length,
      byteLength,
    };
  }
  return {
    blobId,
    contentFormat: content.format,
    kind: content.kind,
    key: content.seriesKey,
    itemCount: content.points.length,
    byteLength,
  };
}

function contentKey(content: LoomBlobContent): LoomBlobReference["key"] {
  return content.format === "loom.table.v0" ? content.tableKey : content.seriesKey;
}

function referenceMatchesContent(reference: LoomBlobReference, content: LoomBlobContent): boolean {
  const actual = referenceFor(content, reference.blobId, reference.byteLength);
  return (
    actual.contentFormat === reference.contentFormat &&
    actual.kind === reference.kind &&
    actual.key === reference.key &&
    actual.itemCount === reference.itemCount
  );
}

function viewReferences(view: LoomBacktestView): LoomBlobReference[] {
  return [view.market, view.equity, view.drawdown, view.trades].filter(
    (reference): reference is LoomBlobReference => reference !== null,
  );
}

function viewPath(
  stateRoot: string,
  view: { viewId: string; provenance: { projectId: string } },
): string {
  return join(stateRoot, "projects", view.provenance.projectId, "views", `${view.viewId}.json`);
}

function blobPath(stateRoot: string, blobId: string): string {
  return join(stateRoot, "artifacts", "blobs", blobId.slice(5, 7), `${blobId}.json`);
}

async function readJson(
  path: string,
  maximumBytes: number,
  missingCode: "VIEW_NOT_FOUND" | "BLOB_NOT_FOUND",
): Promise<unknown> {
  const value = await readJsonIfPresent(path, maximumBytes);
  if (value === undefined)
    throw new ResearchArtifactError(missingCode, "The resource was not found");
  return value;
}

async function readJsonIfPresent(path: string, maximumBytes: number): Promise<unknown | undefined> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new ResearchArtifactError("RESOURCE_TOO_LARGE", "The stored resource is too large");
    }
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    if (error instanceof ResearchArtifactError) throw error;
    throw new ResearchArtifactError("RESOURCE_CORRUPT", "The stored resource could not be read", {
      cause: error,
    });
  }
}

async function writeImmutable(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const byteLength = Buffer.byteLength(bytes);
  const existing = await readTextIfPresent(path, byteLength);
  if (existing !== undefined) {
    if (existing !== bytes) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "An immutable identity was reused");
    }
    return;
  }

  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, path);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      const raced = await readTextIfPresent(path, byteLength);
      if (raced === bytes) return;
    }
    throw new ResearchArtifactError("RESOURCE_WRITE_FAILED", "The resource could not be written", {
      cause: error,
    });
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readTextIfPresent(path: string, maximumBytes: number): Promise<string | undefined> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > maximumBytes) {
      throw new ResearchArtifactError("RESOURCE_CORRUPT", "An immutable resource is invalid");
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function assertPortableId(input: string): void {
  if (!isLoomPortableId(input)) {
    throw new ResearchArtifactError("INVALID_ID", "A portable identifier is required");
  }
}

function assertContentId(input: string, prefix: "blob_" | "view_"): void {
  if (!new RegExp(`^${prefix}[a-f0-9]{64}$`).test(input)) {
    throw new ResearchArtifactError("INVALID_ID", "A content identifier is required");
  }
}

function immutableSnapshot<T>(input: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(input)) as T);
}

function deepFreeze<T>(input: T): T {
  if (input !== null && typeof input === "object" && !Object.isFrozen(input)) {
    Object.freeze(input);
    for (const value of Object.values(input)) deepFreeze(value);
  }
  return input;
}

function isNodeError(input: unknown): input is NodeJS.ErrnoException {
  return input instanceof Error && "code" in input;
}
