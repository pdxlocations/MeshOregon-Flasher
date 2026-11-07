export const CHIP_NAMES = { esp32: 'ESP32', esp32s3: 'ESP32-S3', esp32s2: 'ESP32-S2', esp32c3: 'ESP32-C3', esp32c6: 'ESP32-C6' };
export const canFlash = (target) => Boolean(target?.factory && target?.flash?.length && CHIP_NAMES[target.platform]);
export function validateCatalog(data) {
  if (data.schema !== 1 || data.branch !== 'MeshOregon' || !Array.isArray(data.targets)) throw new Error('This is not a MeshOregon firmware catalog.');
  const boards = new Set();
  for (const target of data.targets) {
    if (!/^[\w.-]+$/.test(target.board) || boards.has(target.board) || !Array.isArray(target.files) || !target.archive?.assetId || !/^[a-f0-9]{64}$/.test(target.archive.sha256)) throw new Error('The build catalog is incomplete.');
    boards.add(target.board);
    for (const file of target.files) if (!/^[\w.-]+$/.test(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 32 * 1024 * 1024) throw new Error('Invalid firmware file in catalog.');
    if (target.factory && !target.files.some((file) => file.name === target.factory)) throw new Error('Missing factory firmware.');
    if (target.factory && (!Array.isArray(target.flash) || !target.flash.some((image) => image.name === target.factory && image.address === 0))) throw new Error('Missing flash layout.');
    let previousEnd = 0;
    for (const image of target.flash || []) {
      const file = target.files.find((item) => item.name === image.name);
      if (!file || !Number.isSafeInteger(image.address) || image.address < previousEnd || image.address % 4096 !== 0) throw new Error('Invalid or overlapping flash layout.');
      previousEnd = image.address + Math.ceil(file.size / 4096) * 4096;
    }
  }
  return data;
}
export async function verifyBytes(bytes, expected, expectedSize) {
  if (bytes.byteLength !== expectedSize) throw new Error('The firmware download is incomplete. Please retry.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('Firmware checksum failed. Nothing was flashed.');
}
export function assertChip(platform, detected) {
  const expected = CHIP_NAMES[platform];
  const actual = detected.toUpperCase().replace(/\(.*$/, '').trim().split(' ')[0];
  if (!expected || actual !== expected) throw new Error(`This build needs ${expected}; connected radio reports ${detected}. Nothing was erased.`);
}
// Every board's factory image, app image, and Meshtastic-style partition manifest
// (`*.mt.json`, bundled by the same build pipeline as meshtastic/web-flasher reads)
// share one base name. Archives that break this convention fall back to a full erase.
const factoryBaseName = (factoryName) => factoryName?.endsWith('.factory.bin') ? factoryName.slice(0, -'.factory.bin'.length) : undefined;
export const appBinaryName = (factoryName) => { const base = factoryBaseName(factoryName); return base && `${base}.bin`; };
export const manifestName = (factoryName) => { const base = factoryBaseName(factoryName); return base && `${base}.mt.json`; };
// The OTA (app1) image isn't listed in the partition manifest; find it in the
// factory flash layout by elimination, the same way web-flasher falls back to
// filename convention when a manifest doesn't name it either.
export const findOtaImage = (target) => target.flash.find((image) => image.name !== target.factory && !image.name.startsWith('littlefs'));
// Mirrors web-flasher's getPartitionOffset(): some manifests label the app
// partitions 'app'/'flashApp' instead of 'app0'/'app1', so fall back to the
// OTA subtype when the expected partition name isn't present.
export function findManifestOffset(manifest, name, subtype) {
  const partition = manifest?.part?.find((entry) => entry.name === name) ?? manifest?.part?.find((entry) => entry.subtype === subtype);
  return partition ? parseInt(partition.offset, 16) : undefined;
}
