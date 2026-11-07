<?php
declare(strict_types=1);
require __DIR__ . '/config.php';
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function cacheDirectory(): string {
    $path = sys_get_temp_dir() . '/meshoregon-flasher-' . substr(hash('sha256', __DIR__ . FIRMWARE_REPOSITORY), 0, 16);
    if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) {
        throw new RuntimeException('The server cannot create its temporary cache.');
    }
    return $path;
}

function curlHandle(string $url) {
    $handle = curl_init($url);
    curl_setopt_array($handle, [CURLOPT_USERAGENT => 'MeshOregon-Flasher/1.0', CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 120,
        CURLOPT_FAILONERROR => true]);
    if (defined('CURLOPT_PROTOCOLS_STR')) {
        curl_setopt($handle, CURLOPT_PROTOCOLS_STR, 'https');
        curl_setopt($handle, CURLOPT_REDIR_PROTOCOLS_STR, 'https');
    } else {
        curl_setopt($handle, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        curl_setopt($handle, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
    }
    return $handle;
}

function requestJSON(string $path): array {
    $url = 'https://api.github.com/repos/' . FIRMWARE_REPOSITORY . $path;
    $handle = curlHandle($url);
    $headers = ['Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28'];
    $token = getenv('MESHOREGON_GITHUB_TOKEN');
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($handle, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true]);
    $body = curl_exec($handle);
    if ($body === false) throw new RuntimeException('GitHub is unavailable or its API limit was reached. Please retry shortly.');
    return json_decode($body, true, 512, JSON_THROW_ON_ERROR);
}

function cached(string $key, callable $load): array {
    $path = cacheDirectory() . '/' . hash('sha256', $key) . '.json';
    if (is_file($path) && time() - filemtime($path) < 300) {
        $result = json_decode((string) file_get_contents($path), true);
        if (is_array($result)) return $result;
    }
    $result = $load();
    file_put_contents($path, json_encode($result, JSON_THROW_ON_ERROR), LOCK_EX);
    return $result;
}

function releaseInfo(?int $id): array {
    $result = cached('release-' . ($id ?? 'latest'), function () use ($id) {
        if ($id !== null) {
            $release = requestJSON('/releases/' . $id);
        } else {
            $release = null;
            for ($page = 1; $page <= 5 && $release === null; $page++) {
                $items = requestJSON('/releases?per_page=30&page=' . $page);
                foreach ($items as $item) {
                    if (strpos($item['tag_name'] ?? '', RELEASE_PREFIX) === 0 && !($item['draft'] ?? true)) {
                        $release = $item;
                        break;
                    }
                }
                if (count($items) < 30) break;
            }
        }
        if (!$release || strpos($release['tag_name'] ?? '', RELEASE_PREFIX) !== 0 || ($release['draft'] ?? true)) {
            throw new RuntimeException('No MeshOregon firmware is available yet.');
        }
        $assets = [];
        for ($page = 1; $page <= 20; $page++) {
            $items = requestJSON('/releases/' . $release['id'] . '/assets?per_page=100&page=' . $page);
            foreach ($items as $asset) $assets[$asset['name']] = $asset;
            if (count($items) < 100) break;
        }
        return ['id' => $release['id'], 'url' => $release['html_url'], 'assets' => $assets];
    });
    if ($id === null) {
        $path = cacheDirectory() . '/' . hash('sha256', 'release-' . $result['id']) . '.json';
        if (!is_file($path) || time() - filemtime($path) >= 300) file_put_contents($path, json_encode($result, JSON_THROW_ON_ERROR), LOCK_EX);
    }
    return $result;
}

function assetURL(array $asset): string {
    $url = $asset['browser_download_url'];
    $prefix = 'https://github.com/' . FIRMWARE_REPOSITORY . '/releases/download/';
    if (strpos($url, $prefix) !== 0) throw new RuntimeException('Invalid release download URL.');
    return $url;
}

function catalog(?int $id): array {
    $release = releaseInfo($id);
    return cached('catalog-' . $release['id'], function () use ($release) {
        $asset = $release['assets']['meshoregon.json'] ?? null;
        if (!$asset) throw new RuntimeException('This release has no firmware catalog.');
        $handle = curlHandle(assetURL($asset));
        curl_setopt($handle, CURLOPT_RETURNTRANSFER, true);
        $body = curl_exec($handle);
        if ($body === false || strlen($body) > 8 * 1024 * 1024) throw new RuntimeException('Could not load the firmware catalog.');
        $data = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        if (($data['schema'] ?? null) !== 1 || ($data['branch'] ?? '') !== 'MeshOregon' || !is_array($data['targets'] ?? null)) {
            throw new RuntimeException('Invalid MeshOregon build catalog.');
        }
        foreach ($data['targets'] as &$target) {
            $archive = $release['assets'][$target['archive']['name']] ?? null;
            if (!$archive || $archive['size'] !== $target['archive']['size']) throw new RuntimeException('The published build is incomplete.');
            $target['archive']['assetId'] = $archive['id'];
        }
        unset($target);
        $data['releaseId'] = $release['id'];
        $data['releaseUrl'] = $release['url'];
        return $data;
    });
}

try {
    if (!extension_loaded('curl')) throw new RuntimeException('Enable the PHP cURL extension on this server.');
    if (isset($_GET['catalog'])) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(catalog(null), JSON_THROW_ON_ERROR);
        exit;
    }
    $releaseId = filter_input(INPUT_GET, 'release', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $assetId = filter_input(INPUT_GET, 'asset', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$releaseId || !$assetId) { http_response_code(400); throw new RuntimeException('Invalid firmware request.'); }
    $data = catalog($releaseId);
    $target = null;
    foreach ($data['targets'] as $item) if ($item['archive']['assetId'] === $assetId) { $target = $item; break; }
    if (!$target) { http_response_code(404); throw new RuntimeException('Firmware asset not found in this release.'); }
    $archive = $target['archive'];
    if (!preg_match('/^[a-f0-9]{64}$/D', $archive['sha256']) || !preg_match('/^[\w.-]+\.zip$/D', $archive['name']) || $archive['size'] > 64 * 1024 * 1024) {
        throw new RuntimeException('Invalid firmware archive.');
    }
    $asset = releaseInfo($releaseId)['assets'][$archive['name']];
    // Use a temporary stream so upstream errors and checksum failures never become partial firmware responses.
    $stream = tmpfile();
    if ($stream === false) throw new RuntimeException('The server cannot buffer a firmware download.');
    $handle = curlHandle(assetURL($asset));
    curl_setopt($handle, CURLOPT_FILE, $stream);
    curl_setopt($handle, CURLOPT_NOPROGRESS, false);
    curl_setopt($handle, CURLOPT_XFERINFOFUNCTION, static function ($handle, $total, $downloaded) { return $downloaded > 64 * 1024 * 1024 ? 1 : 0; });
    if (!curl_exec($handle)) throw new RuntimeException('Firmware download failed. Please retry.');
    $meta = stream_get_meta_data($stream);
    if (fstat($stream)['size'] !== $archive['size'] || hash_file('sha256', $meta['uri']) !== $archive['sha256']) {
        throw new RuntimeException('Firmware checksum failed. Please retry after the build is republished.');
    }
    rewind($stream);
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $archive['name'] . '"');
    header('Content-Length: ' . $archive['size']);
    fpassthru($stream);
    fclose($stream);
} catch (Throwable $error) {
    if (http_response_code() < 400) http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $error instanceof RuntimeException ? $error->getMessage() : 'Could not read the release data. Please retry.']);
}
