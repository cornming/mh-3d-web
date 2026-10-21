[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,

    [Parameter()]
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = if ($projectRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $projectRoot
} else {
    $projectRoot + [System.IO.Path]::DirectorySeparatorChar
}

$mimeTypes = @{
    '.css'   = 'text/css; charset=utf-8'
    '.csv'   = 'text/csv; charset=utf-8'
    '.glb'   = 'model/gltf-binary'
    '.gltf'  = 'model/gltf+json'
    '.html'  = 'text/html; charset=utf-8'
    '.ico'   = 'image/x-icon'
    '.js'    = 'text/javascript; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.mjs'   = 'text/javascript; charset=utf-8'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.svg'   = 'image/svg+xml'
    '.txt'   = 'text/plain; charset=utf-8'
    '.wasm'  = 'application/wasm'
    '.webp'  = 'image/webp'
}

function Get-ContentType {
    param([string]$Path)

    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($mimeTypes.ContainsKey($extension)) {
        return $mimeTypes[$extension]
    }
    return 'application/octet-stream'
}

function Resolve-SafePath {
    param([string]$RequestPath)

    if ([string]::IsNullOrWhiteSpace($RequestPath) -or $RequestPath.Contains([char]0)) {
        return $null
    }

    try {
        $decodedPath = [System.Uri]::UnescapeDataString($RequestPath)
        $relativePath = $decodedPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($projectRoot, $relativePath))
    } catch {
        return $null
    }

    if ($candidate -ne $projectRoot -and
        -not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }

    return $candidate
}

$listener = [System.Net.HttpListener]::new()
$baseUrl = "http://localhost:$Port/"
$listener.Prefixes.Add($baseUrl)

try {
    $listener.Start()
    Write-Host "✅ 靜態伺服器已啟動：$baseUrl" -ForegroundColor Green
    Write-Host "📁 根目錄：$projectRoot" -ForegroundColor DarkGray
    Write-Host '按 Ctrl+C 停止伺服器。' -ForegroundColor DarkGray

    if (-not $NoBrowser) {
        Start-Process $baseUrl
    }

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response

        try {
            if ($context.Request.HttpMethod -notin @('GET', 'HEAD')) {
                $response.StatusCode = 405
                $response.StatusDescription = 'Method Not Allowed'
                $response.Headers.Add([System.Net.HttpResponseHeader]::Allow, 'GET, HEAD')
                $body = [System.Text.Encoding]::UTF8.GetBytes('405 Method Not Allowed')
            } else {
                $requestPath = $context.Request.Url.AbsolutePath
                $filePath = Resolve-SafePath $requestPath

                if ($null -eq $filePath) {
                    $response.StatusCode = 403
                    $response.StatusDescription = 'Forbidden'
                    $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                } else {
                    if ([System.IO.Directory]::Exists($filePath)) {
                        $filePath = [System.IO.Path]::Combine($filePath, 'index.html')
                    }

                    if (-not [System.IO.File]::Exists($filePath)) {
                        $response.StatusCode = 404
                        $response.StatusDescription = 'Not Found'
                        $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
                    } else {
                        $response.StatusCode = 200
                        $response.ContentType = Get-ContentType $filePath
                        $body = [System.IO.File]::ReadAllBytes($filePath)
                    }
                }
            }

            $response.ContentLength64 = $body.Length
            if ($context.Request.HttpMethod -ne 'HEAD') {
                $response.OutputStream.Write($body, 0, $body.Length)
            }
        } catch {
            $response.StatusCode = 500
            $body = [System.Text.Encoding]::UTF8.GetBytes('500 Internal Server Error')
            $response.ContentLength64 = $body.Length
            $response.OutputStream.Write($body, 0, $body.Length)
        } finally {
            $response.Close()
        }
    }
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
