// @effect-diagnostics nodeBuiltinImport:off - Inflates downloaded archives with Node's zlib.
import * as NodeZlib from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const MAX_ENTRIES = 64;
const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;

/**
 * Reads the top-level files of a zip archive. Folders, nested paths and anything unsafe are
 * skipped, and total unpacked size is capped so a small download cannot expand without limit.
 */
export function readPetArchive(bytes: Uint8Array): Map<string, Uint8Array> {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  const end = findEndOfCentralDirectory(data);
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw new Error("The archive has too many files.");
  let unpacked = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL_ENTRY) {
      throw new Error("The archive is damaged.");
    }
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name === "" || name.includes("/") || name.includes("\\") || name.includes("\0")) continue;
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error("The archive is too large when unpacked.");
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== LOCAL_ENTRY) {
      throw new Error("The archive is damaged.");
    }
    const start =
      localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    if (start + compressedSize > data.length) throw new Error("The archive is truncated.");
    const packed = data.subarray(start, start + compressedSize);
    const content =
      method === 0
        ? Buffer.from(packed)
        : method === 8
          ? NodeZlib.inflateRawSync(packed, { maxOutputLength: MAX_UNPACKED_BYTES })
          : null;
    if (content === null) throw new Error("The archive uses an unsupported compression method.");
    if (content.length !== size) throw new Error("The archive is damaged.");
    files.set(name, content);
  }
  return files;
}

function findEndOfCentralDirectory(data: Buffer): number {
  const earliest = Math.max(0, data.length - 22 - 0xffff);
  for (let index = data.length - 22; index >= earliest; index -= 1) {
    if (data.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) return index;
  }
  throw new Error("The download is not a zip archive.");
}
