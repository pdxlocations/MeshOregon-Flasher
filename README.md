# MeshOregon Flasher

A minimal, self-contained web flasher for published Meshtastic releases built
with the userPrefs and splash from
[`pdxlocations/firmware`, branch `MeshOregon`](https://github.com/pdxlocations/firmware/tree/MeshOregon).
No Node server, database, third-party CDN, or hosting subscription is required.

## Upload to DreamHost

1. Run `npm ci` and `npm run build` locally to generate `dist/`.
2. Enable HTTPS and PHP 8.1 or later with cURL for your domain.
3. Upload **the contents of `dist/`**, including `.htaccess`, to the domain's web
   directory. No build is needed on DreamHost.
4. Confirm `config.php` points at your firmware repository.
5. Open the site in desktop Chrome or Edge to flash an ESP32 radio.

Generated `dist/` output and deployment ZIPs are excluded from Git.

The site also works from a subdirectory. `api.php` relays only firmware archives
listed in the configured repository's MeshOregon releases. This avoids GitHub's
cross-origin restrictions on binary downloads. It caches release metadata for
five minutes in the system temp directory; PHP needs write access there. Firmware
archives are buffered temporarily, checked, streamed, and discarded. The repository
and releases must be public. An optional server environment variable
`MESHOREGON_GITHUB_TOKEN` raises the GitHub API rate limit; never put a token in
JavaScript or the upload bundle.

## Publish firmware

1. Commit and push the desired `userPrefs.jsonc` on
   **MeshOregon**. This branch supplies the preferences and splash, not the base
   firmware version.
2. Commit and push `.github/workflows/meshoregon.yml`,
   `.github/workflows/meshoregon-build.yml`, and `bin/meshoregon/` on the
   default branch, **master**.
3. In Actions, choose **Build MeshOregon → Run workflow**, select **master**, and
   enter `2.8.2` in **version**. This resolves the newest published 2.8.2 tag;
   an exact tag such as `v2.8.2.d5f1619` also works. Leave it blank for the newest
   published release of any version.

The workflow also checks upstream releases hourly, at minute 17 UTC. It includes
Alpha/Beta prereleases and ignores drafts. GitHub schedules can be delayed, and
GitHub may disable schedules on inactive public repositories. A source release
and MeshOregon profile that already have a successful build are skipped; failed
builds are retried on the next check. A changed profile permits a fresh build of
the same upstream release.

Every build pins the upstream release commit and the MeshOregon profile commit.
Firmware code and submodules come from `meshtastic/firmware`; only the profile's
userPrefs is overlaid. Packaging tools come from master. Version strings therefore identify
the real upstream release. No branch history is merged or rewritten.

Normal upstream release hardware targets are built; experimental `extra` boards, native/desktop, and
buildroot environments are excluded. Target matrices are split into groups of at
most 128, with up to 20 builds per group running concurrently. A failed target
blocks publication. Successful builds publish a prerelease named
`meshoregon-<upstream-tag>-<profile-commit-prefix>`. The site discovers it within
five minutes, including prereleases; it does not use `/releases/latest`.

Each release contains `meshoregon.json` and one ZIP per board, with SHA-256
checksums and both source commits recorded in the catalog. ESP32 archives include
factory, filesystem, and applicable OTA images with board-specific partition
offsets. The build constrains `pioarduino==6.2.0` to avoid the known post-release
version-check incompatibility. The flasher does not change radio configuration
after installation.

## Installation behavior

- ESP32 families: Web Serial installation using bundled Espressif `esptool-js`,
  the same engine and partition handling as the official
  [`meshtastic/web-flasher`](https://github.com/meshtastic/web-flasher). The
  radio chip is checked before writing. A "Full erase" checkbox, checked by
  default, chooses between two modes, both requiring confirmation:
  - **Full erase**: erases the whole chip, then writes the factory image
    (bootloader, partition table, app) at offset 0, the OTA slot, and a fresh
    filesystem image. This resets everything, including saved settings,
    messages, and identity keys.
  - **Update** (uncheck "Full erase"): writes only the app partition and the
    OTA slot, at the real offsets read from the build's bundled per-board
    partition manifest (`*.mt.json`, the same manifest format
    `meshtastic/web-flasher` reads). No chip erase occurs and the filesystem
    and settings/identity (NVS) partitions are never touched, so saved
    settings, messages, and identity keys survive.

  Either way, each written image is verified against its catalog checksum
  before flashing and its on-device MD5 checksum after, and the device
  restarts afterward.
- nRF52 and RP2040/RP2350: download the verified UF2, double-press reset, then copy
  it onto the device's bootloader USB drive. Some boards require their vendor's
  bootloader setup first.
- Other boards: download the firmware archive for the appropriate vendor tool.
- This is a fresh installer, not a settings-preserving updater. Back up deployed
  nodes first.

## Local development

```sh
npm ci
npm test
npm run build
npm run dev
```

Visit `http://127.0.0.1:8080`. Web Serial works on localhost; public hosting requires
HTTPS. If no build has been published, the interface shows an honest empty state.
To change the release source, edit `public/config.php`, then rebuild. Source files
are in `src/` and `public/`; only `dist/` belongs on the web server.

The uploaded build includes dependency license notices. `esptool-js` is Apache-2.0;
`fflate` and `spark-md5` are MIT licensed. See `dist/THIRD-PARTY-LICENSES.txt`.

## Visual assets

The logo and favicon are downloaded unchanged from MeshOregon.com. The black background, green `#0cf57e` controls, and Exo 2 headings follow the public MeshOregon theme. Exo 2 is bundled locally with its SIL Open Font License in `dist/fonts/OFL.txt`.
