[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'

$serverRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$indexFile = [System.IO.Path]::Combine($serverRoot, 'index.html')
$baseUrl = "http://localhost:$Port/"
$pathComparison = if ($env:OS -eq 'Windows_NT') {
    [System.StringComparison]::OrdinalIgnoreCase
} else {
    [System.StringComparison]::Ordinal
}

if (-not [System.IO.File]::Exists($indexFile)) {
    throw "找不到入口檔案：$indexFile"
}

$rootPrefix = $serverRoot
if (-not $rootPrefix.EndsWith([System.IO.Path]::DirectorySeparatorChar) -and
    -not $rootPrefix.EndsWith([System.IO.Path]::AltDirectorySeparatorChar)) {
    $rootPrefix += [System.IO.Path]::DirectorySeparatorChar
}

$invalidFileNameChars = [System.IO.Path]::GetInvalidFileNameChars()
$ascii = [System.Text.Encoding]::ASCII
$utf8 = [System.Text.Encoding]::UTF8
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.xml'  = 'application/xml; charset=utf-8'
    '.svg'  = 'image/svg+xml; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.ico'  = 'image/x-icon'
    '.wasm' = 'application/wasm'
    '.pdf'  = 'application/pdf'
    '.mp3'  = 'audio/mpeg'
    '.wav'  = 'audio/wav'
    '.ogg'  = 'audio/ogg'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.woff' = 'font/woff'
    '.woff2' = 'font/woff2'
    '.ttf'  = 'font/ttf'
}

function New-ResolutionResult {
    param(
        [int]$StatusCode,
        [string]$Message,
        [string]$FilePath
    )

    [pscustomobject]@{
        StatusCode = $StatusCode
        Message    = $Message
        FilePath   = $FilePath
    }
}

function Resolve-RequestFile {
    param(
        [Parameter(Mandatory)]
        [string]$RawPath
    )

    try {
        $decodedPath = [System.Uri]::UnescapeDataString($RawPath)
    } catch {
        return New-ResolutionResult -StatusCode 400 -Message '無效的 URL 路徑。'
    }

    if ([string]::IsNullOrEmpty($decodedPath)) {
        $decodedPath = '/'
    }

    if ($decodedPath.IndexOf([char]0) -ge 0 -or $decodedPath.Contains('\')) {
        return New-ResolutionResult -StatusCode 403 -Message '禁止存取此路徑。'
    }

    $segments = $decodedPath.TrimStart('/') -split '/'
    $relativeSegments = @()
    foreach ($segment in $segments) {
        if ([string]::IsNullOrEmpty($segment)) {
            continue
        }

        if ($segment -eq '.' -or $segment -eq '..' -or
            $segment.Contains(':') -or $segment.IndexOfAny($invalidFileNameChars) -ge 0) {
            return New-ResolutionResult -StatusCode 403 -Message '禁止存取此路徑。'
        }

        $relativeSegments += $segment
    }

    try {
        if ($relativeSegments.Count -eq 0) {
            $candidatePath = $indexFile
        } else {
            $relativePath = [string]::Join([System.IO.Path]::DirectorySeparatorChar, [string[]]$relativeSegments)
            $candidatePath = Join-Path -Path $serverRoot -ChildPath $relativePath
        }

        $candidatePath = [System.IO.Path]::GetFullPath($candidatePath)
        if ([System.IO.Directory]::Exists($candidatePath)) {
            $candidatePath = [System.IO.Path]::GetFullPath((Join-Path -Path $candidatePath -ChildPath 'index.html'))
        }
    } catch {
        return New-ResolutionResult -StatusCode 400 -Message '無法解析要求的路徑。'
    }

    $isWithinRoot = $candidatePath.Equals($serverRoot, $pathComparison) -or
        $candidatePath.StartsWith($rootPrefix, $pathComparison)
    if (-not $isWithinRoot) {
        return New-ResolutionResult -StatusCode 403 -Message '禁止存取此路徑。'
    }

    if (-not [System.IO.File]::Exists($candidatePath)) {
        return New-ResolutionResult -StatusCode 404 -Message '找不到要求的檔案。'
    }

    New-ResolutionResult -StatusCode 200 -Message $null -FilePath $candidatePath
}

function Get-MimeType {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath
    )

    $extension = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
    if ($mimeTypes.ContainsKey($extension)) {
        return $mimeTypes[$extension]
    }

    'application/octet-stream'
}

function Get-StatusDescription {
    param(
        [Parameter(Mandatory)]
        [int]$StatusCode
    )

    switch ($StatusCode) {
        200 { 'OK'; break }
        400 { 'Bad Request'; break }
        403 { 'Forbidden'; break }
        404 { 'Not Found'; break }
        405 { 'Method Not Allowed'; break }
        500 { 'Internal Server Error'; break }
        default { 'Response' }
    }
}

function Send-HttpResponse {
    param(
        [Parameter(Mandatory)]
        [System.Net.Sockets.NetworkStream]$Stream,
        [Parameter(Mandatory)]
        [string]$Method,
        [Parameter(Mandatory)]
        [int]$StatusCode,
        [Parameter(Mandatory)]
        [string]$ContentType,
        [Parameter(Mandatory)]
        [byte[]]$Body,
        [string]$Allow
    )

    $statusDescription = Get-StatusDescription -StatusCode $StatusCode
    $headerLines = @(
        "HTTP/1.1 $StatusCode $statusDescription"
        "Content-Type: $ContentType"
        "Content-Length: $($Body.LongLength)"
        'Connection: close'
        'Cache-Control: no-cache'
        'X-Content-Type-Options: nosniff'
    )
    if ($Allow) {
        $headerLines += "Allow: $Allow"
    }

    $headerBytes = $ascii.GetBytes(($headerLines -join "`r`n") + "`r`n`r`n")
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Method -ne 'HEAD' -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
}

function Send-TextResponse {
    param(
        [Parameter(Mandatory)]
        [System.Net.Sockets.NetworkStream]$Stream,
        [Parameter(Mandatory)]
        [string]$Method,
        [Parameter(Mandatory)]
        [int]$StatusCode,
        [Parameter(Mandatory)]
        [string]$Message,
        [string]$Allow
    )

    $body = $utf8.GetBytes($Message + [Environment]::NewLine)
    Send-HttpResponse -Stream $Stream -Method $Method -StatusCode $StatusCode `
        -ContentType 'text/plain; charset=utf-8' -Body $body -Allow $Allow
}

function Read-HttpRequest {
    param(
        [Parameter(Mandatory)]
        [System.Net.Sockets.NetworkStream]$Stream
    )

    $buffer = New-Object byte[] 4096
    $memory = New-Object System.IO.MemoryStream
    $headerTerminator = -1

    try {
        while ($memory.Length -lt 16384) {
            $bytesRead = $Stream.Read($buffer, 0, $buffer.Length)
            if ($bytesRead -le 0) {
                break
            }

            $memory.Write($buffer, 0, $bytesRead)
            $requestText = $ascii.GetString($memory.ToArray())
            $headerTerminator = $requestText.IndexOf("`r`n`r`n", [System.StringComparison]::Ordinal)
            if ($headerTerminator -ge 0) {
                break
            }
        }

        if ($headerTerminator -lt 0) {
            return $null
        }

        $requestText = $ascii.GetString($memory.ToArray())
        $requestLine = $requestText.Substring(0, $headerTerminator).Split("`r`n")[0]
        $parts = $requestLine -split '\s+', 3
        if ($parts.Count -ne 3 -or $parts[2] -notmatch '^HTTP/1\.[01]$') {
            return $null
        }

        $method = $parts[0].ToUpperInvariant()
        $rawTarget = $parts[1]
        if (-not $rawTarget.StartsWith('/')) {
            return $null
        }

        $rawPath = $rawTarget
        $queryIndex = $rawPath.IndexOf('?')
        if ($queryIndex -ge 0) {
            $rawPath = $rawPath.Substring(0, $queryIndex)
        }
        if ([string]::IsNullOrEmpty($rawPath)) {
            $rawPath = '/'
        }

        [pscustomobject]@{
            Method  = $method
            RawPath = $rawPath
        }
    } finally {
        $memory.Dispose()
    }
}

function Handle-Client {
    param(
        [Parameter(Mandatory)]
        [System.Net.Sockets.TcpClient]$Client
    )

    $stream = $Client.GetStream()
    try {
        $request = Read-HttpRequest -Stream $stream
        if ($null -eq $request) {
            Send-TextResponse -Stream $stream -Method 'GET' -StatusCode 400 `
                -Message '無效的 HTTP 要求。'
            return
        }

        if ($request.Method -ne 'GET' -and $request.Method -ne 'HEAD') {
            Send-TextResponse -Stream $stream -Method $request.Method -StatusCode 405 `
                -Message '只支援 GET 與 HEAD 要求。' -Allow 'GET, HEAD'
            return
        }

        $resolution = Resolve-RequestFile -RawPath $request.RawPath
        if ($resolution.StatusCode -ne 200) {
            Send-TextResponse -Stream $stream -Method $request.Method `
                -StatusCode $resolution.StatusCode -Message $resolution.Message
            return
        }

        try {
            $body = [System.IO.File]::ReadAllBytes($resolution.FilePath)
        } catch {
            Send-TextResponse -Stream $stream -Method $request.Method -StatusCode 500 `
                -Message '讀取檔案時發生錯誤。'
            return
        }

        Send-HttpResponse -Stream $stream -Method $request.Method -StatusCode 200 `
            -ContentType (Get-MimeType -FilePath $resolution.FilePath) -Body $body
    } finally {
        $stream.Dispose()
    }
}

$listener = New-Object -TypeName System.Net.Sockets.TcpListener `
    -ArgumentList ([System.Net.IPAddress]::Loopback, $Port)

try {
    $listener.Start()
} catch {
    $listener.Stop()
    $listener.Dispose()
    throw "無法啟動 $baseUrl。請確認連接埠未被使用，或改用 -Port 指定其他連接埠。"
}

try {
    Write-Host "靜態伺服器已啟動：$baseUrl" -ForegroundColor Green
    Write-Host "服務根目錄：$serverRoot"
    Write-Host '按 Ctrl+C 停止伺服器。'

    try {
        Start-Process -FilePath $baseUrl -ErrorAction Stop | Out-Null
    } catch {
        Write-Warning "無法自動開啟瀏覽器，請手動前往 $baseUrl"
    }

    while ($listener.Server.IsBound) {
        $client = $null
        try {
            $client = $listener.AcceptTcpClient()
        } catch {
            if ($listener.Server.IsBound) {
                Write-Warning '接收 TCP 要求時發生錯誤，伺服器即將停止。'
            }
            break
        }

        try {
            Handle-Client -Client $client
        } catch {
            # 用戶端可能在回應完成前中斷連線。
        } finally {
            if ($null -ne $client) {
                $client.Dispose()
            }
        }
    }
} finally {
    if ($listener.Server.IsBound) {
        $listener.Stop()
    }
    $listener.Dispose()
}
