import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { assertChip, verifyBytes, validateCatalog, canFlash, appBinaryName, manifestName, findOtaImage, findManifestOffset } from '../src/core.js';
const bytes = new TextEncoder().encode('firmware');
const sha = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
const fixture = () => ({schema:1, branch:'MeshOregon', targets:[{board:'heltec-v3',platform:'esp32s3',factory:'firmware.factory.bin',flash:[{name:'firmware.factory.bin',address:0}],archive:{assetId:1,sha256:sha},files:[{name:'firmware.factory.bin',size:bytes.length,sha256:sha}]}]});
test('only ESP factory builds are offered browser flashing', () => { assert.equal(canFlash(fixture().targets[0]),true); assert.equal(canFlash({platform:'nrf52840',uf2:'test.uf2'}),false); });
test('rejects a chip mismatch before flashing', () => { assert.doesNotThrow(()=>assertChip('esp32s3','ESP32-S3')); assert.throws(()=>assertChip('esp32s3','ESP32-C3'),/Nothing was erased/); });
test('rejects truncated and modified firmware', async () => { await verifyBytes(bytes,sha,bytes.length); await assert.rejects(verifyBytes(bytes,sha,100),/incomplete/); await assert.rejects(verifyBytes(new Uint8Array(bytes.length),sha,bytes.length),/checksum/); });
test('rejects wrong branch, duplicate targets, and missing factory files', () => { assert.equal(validateCatalog(fixture()).targets.length,1); const wrong=fixture(); wrong.branch='master'; assert.throws(()=>validateCatalog(wrong)); const duplicate=fixture(); duplicate.targets.push(duplicate.targets[0]); assert.throws(()=>validateCatalog(duplicate)); const missing=fixture(); missing.targets[0].factory='absent.bin'; assert.throws(()=>validateCatalog(missing)); });

test('rejects overlapping flash partitions', () => { const overlap=fixture(); overlap.targets[0].flash.push({name:'firmware.factory.bin',address:0}); assert.throws(()=>validateCatalog(overlap),/overlapping/); });

test('derives the app binary and manifest names from the factory name', () => { assert.equal(appBinaryName('firmware-heltec-v3-2.8.2.factory.bin'),'firmware-heltec-v3-2.8.2.bin'); assert.equal(manifestName('firmware-heltec-v3-2.8.2.factory.bin'),'firmware-heltec-v3-2.8.2.mt.json'); assert.equal(appBinaryName('not-a-factory-image.bin'),undefined); assert.equal(manifestName('not-a-factory-image.bin'),undefined); });
test('finds the OTA image in a flash layout by elimination', () => { const target={factory:'firmware.factory.bin',flash:[{name:'firmware.factory.bin',address:0},{name:'mt-esp32s3-ota.bin',address:0x340000},{name:'littlefs-heltec-v3.bin',address:0x670000}]}; assert.deepEqual(findOtaImage(target),{name:'mt-esp32s3-ota.bin',address:0x340000}); assert.equal(findOtaImage({factory:'firmware.factory.bin',flash:[{name:'firmware.factory.bin',address:0},{name:'littlefs-heltec-v3.bin',address:0x300000}]}),undefined); });
test('reads the app partition offset from a manifest, falling back to its OTA subtype', () => {
  assert.equal(findManifestOffset({part:[{name:'app0',subtype:'ota_0',offset:'0x10000'}]},'app0','ota_0'),0x10000);
  assert.equal(findManifestOffset({part:[{name:'app',subtype:'ota_0',offset:'0x10000'}]},'app0','ota_0'),0x10000);
  assert.equal(findManifestOffset({part:[{name:'nvs',subtype:'nvs',offset:'0x9000'}]},'app0','ota_0'),undefined);
});
