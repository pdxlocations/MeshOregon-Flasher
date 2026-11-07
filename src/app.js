import { canFlash, validateCatalog, verifyBytes, assertChip, appBinaryName, manifestName, findOtaImage, findManifestOffset } from './core.js';
const $ = (id) => document.getElementById(id);
let catalog;
let busy = false;
let transport;
let logText = '';
const supported = window.isSecureContext && 'serial' in navigator;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function log(text) { logText = (logText + text + '\n').slice(-16000); const el = $('log'); el.textContent = logText; el.scrollTop = el.scrollHeight; }
function selected() { return catalog?.targets.find((target) => target.board === $('board').value); }
function assetURL(target) { return `api.php?release=${catalog.releaseId}&asset=${target.archive.assetId}`; }
function select() {
  const target = selected();
  const flashable = canFlash(target);
  $('install').disabled = busy || !target || (flashable && !supported);
  $('button-label').textContent = !target ? 'Choose a radio' : flashable ? 'Connect & install' : 'Download firmware';
  $('download').hidden = !target || !flashable;
  if (target) { $('download').href = assetURL(target); $('download').download = target.archive.name; }
  $('erase-option').hidden = !flashable;
  $('full-erase').disabled = busy;
  $('hint').textContent = !target ? 'Choose the exact model printed on your radio.' : flashable ? (supported ? 'A full erase replaces everything, including saved settings; uncheck it to update firmware while keeping your settings, messages, and identity keys.' : 'Use desktop Chrome or Edge over HTTPS for USB installation.') : target.uf2 ? 'Double-press reset, then copy the downloaded UF2 onto the radio’s USB drive.' : 'Download the firmware archive and use your board’s installation tool.';
  if (!busy) status('');
}
async function load() {
  $('retry').hidden = true;
  $('release').textContent = 'Finding the latest build…';
  try {
    const response = await fetch('api.php?catalog=1', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load firmware.');
    catalog = validateCatalog(data);
    $('board').replaceChildren(new Option('Select your radio', ''));
    for (const target of [...catalog.targets].sort((a, b) => a.board.localeCompare(b.board))) $('board').add(new Option(target.displayName && target.displayName !== target.board ? `${target.displayName} · ${target.board}` : target.board, target.board));
    $('board').disabled = false;
    $('release').textContent = `${catalog.version} · ${catalog.targets.length} ${catalog.targets.length === 1 ? 'radio' : 'radios'}`;
    $('release-link').href = catalog.releaseUrl;
    $('release-link').hidden = false;
    select();
  } catch (error) {
    $('release').textContent = 'No build available';
    $('board').replaceChildren(new Option('No published radios yet', ''));
    $('board').disabled = true;
    $('install').disabled = true;
    $('retry').hidden = false;
    status(error.message, true);
  }
}
async function downloadUF2(target) {
  const response = await fetch(assetURL(target));
  if (!response.ok) throw new Error('Firmware download failed. Please retry.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyBytes(bytes, target.archive.sha256, target.archive.size);
  const { unzipSync } = await import('fflate');
  const files = unzipSync(bytes, { filter: (file) => file.name === target.uf2 });
  const file = target.files.find((item) => item.name === target.uf2);
  if (!files[target.uf2] || !file) throw new Error('The archive is missing its UF2 firmware.');
  await verifyBytes(files[target.uf2], file.sha256, file.size);
  const url = URL.createObjectURL(new Blob([files[target.uf2]], { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = target.uf2; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Full erase writes the complete factory image (bootloader, partition table, app)
// plus the OTA slot and filesystem, after erasing the whole chip — this resets
// everything, matching web-flasher's cleanInstallEspFlash.
// Update writes only the app partition (and OTA slot) at their real offsets,
// taken from the build's bundled Meshtastic-style partition manifest, without
// erasing — the filesystem and NVS settings/identity partition are never
// touched, matching web-flasher's updateEspFlash.
async function selectImages(target, bytes, unzipSync, fullErase) {
  if (fullErase) {
    const wanted = new Set(target.flash.map((image) => image.name));
    const files = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
    const images = [];
    for (const image of target.flash) {
      const record = target.files.find((file) => file.name === image.name);
      if (!files[image.name] || !record) throw new Error('A required firmware image is missing from this build.');
      await verifyBytes(files[image.name], record.sha256, record.size);
      images.push({ data: files[image.name], address: image.address });
    }
    return images;
  }
  const appName = appBinaryName(target.factory);
  const manifestFile = manifestName(target.factory);
  const ota = findOtaImage(target);
  if (!appName || !manifestFile) throw new Error('This build does not support updating without a full erase.');
  const wanted = new Set([appName, manifestFile, ...(ota ? [ota.name] : [])]);
  const files = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  if (!files[manifestFile]) throw new Error('This build is missing its partition manifest; use a full erase instead.');
  const manifest = JSON.parse(new TextDecoder().decode(files[manifestFile]));
  const appOffset = findManifestOffset(manifest, 'app0', 'ota_0');
  if (appOffset === undefined) throw new Error('Could not determine the app partition offset; use a full erase instead.');
  const appRecord = target.files.find((file) => file.name === appName);
  if (!files[appName] || !appRecord) throw new Error('A required firmware image is missing from this build.');
  await verifyBytes(files[appName], appRecord.sha256, appRecord.size);
  const images = [{ data: files[appName], address: appOffset }];
  const otaRecord = ota && target.files.find((file) => file.name === ota.name);
  if (ota && files[ota.name] && otaRecord) { await verifyBytes(files[ota.name], otaRecord.sha256, otaRecord.size); images.push({ data: files[ota.name], address: ota.address }); }
  return images;
}
async function flash(target) {
  // Keep the port picker directly in the confirmation click's user activation.
  const port = await navigator.serial.requestPort();
  const fullErase = $('full-erase').checked;
  busy = true; select(); $('board').disabled = true;
  $('diagnostics').hidden = false; $('progress').hidden = false; $('progress').value = 0;
  try {
    status('Downloading and verifying firmware…');
    const [response, { ESPLoader, Transport }, { unzipSync }, { default: SparkMD5 }] = await Promise.all([fetch(assetURL(target)), import('esptool-js'), import('fflate'), import('spark-md5')]);
    if (!response.ok) throw new Error('Firmware download failed. Please retry.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyBytes(bytes, target.archive.sha256, target.archive.size);
    const images = await selectImages(target, bytes, unzipSync, fullErase);
    transport = new Transport(port, true);
    const loader = new ESPLoader({ transport, baudrate: 115200, terminal: { clean: () => {}, writeLine: log, write: log } });
    status('Connecting to your radio…');
    await loader.main();
    assertChip(target.platform, loader.chip.CHIP_NAME);
    const detectedSize = await loader.detectFlashSize();
    const capacity = loader.flashSizeBytes(detectedSize);
    if (capacity < 1 || images.some((image) => image.address + image.data.byteLength > capacity)) throw new Error('This build does not fit the connected radio’s flash. Nothing was erased.');
    status(fullErase ? 'Installing. Keep your radio connected…' : 'Updating. Keep your radio connected…');
    await loader.writeFlash({ fileArray: images, flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: fullErase, compress: true, calculateMD5Hash: (image) => SparkMD5.ArrayBuffer.hash(image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength)), reportProgress: (index, written, total) => { $('progress').value = Math.round((index + written / total) / images.length * 100); } });
    await loader.after('hard_reset');
    $('progress').value = 100;
    status(fullErase ? 'Installed. Your radio is restarting.' : 'Updated. Your radio is restarting.');
  } catch (error) { status(error.message || 'Installation failed. Reconnect your radio and retry.', true); log(String(error)); }
  finally {
    if (transport) { try { await transport.disconnect(); } catch {} transport = undefined; }
    busy = false; $('board').disabled = false;
    $('install').disabled = false;
  }
}
$('board').addEventListener('change', select);
$('retry').addEventListener('click', load);
$('install').addEventListener('click', async () => {
  const target = selected();
  if (!target || busy) return;
  if (canFlash(target)) {
    const fullErase = $('full-erase').checked;
    $('confirm-board').textContent = `Install MeshOregon on ${target.board}.`;
    $('confirm-title').textContent = fullErase ? 'Erase & install?' : 'Update firmware?';
    $('confirm-warning').textContent = fullErase ? 'This erases all saved settings, messages, and identity keys. Back up your radio first.' : 'This updates firmware and keeps your saved settings, messages, and identity keys.';
    $('confirm-install').textContent = fullErase ? 'Erase & install' : 'Update';
    $('confirm').showModal();
    return;
  }
  if (!target.uf2) { window.location.href = assetURL(target); return; }
  busy = true; select(); $('board').disabled = true; status('Preparing your firmware…');
  try { await downloadUF2(target); status('Downloaded. Copy the UF2 to your radio’s bootloader drive.'); }
  catch (error) { status(error.message, true); }
  finally { busy = false; $('board').disabled = false; $('install').disabled = false; }
});
$('confirm').querySelector('form').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'install') flash(selected()).catch((error) => { if (error.name !== 'NotFoundError') status(error.message, true); });
});
window.addEventListener('beforeunload', (event) => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
load();
