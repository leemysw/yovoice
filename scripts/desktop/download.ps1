# 构建脚本共用的下载：GitHub Releases 偶尔返回 502/504 或中途断开，失败后等一会儿重试。
# Windows PowerShell 5.1 的 Invoke-WebRequest 没有 -MaximumRetryCount，所以自己循环。
function Save-Url([string]$Url, [string]$OutFile, [int]$Attempts = 5) {
    for ($i = 1; ; $i++) {
        try {
            Invoke-WebRequest $Url -OutFile $OutFile -UseBasicParsing
            return
        } catch {
            if ($i -ge $Attempts) { throw }
            Write-Warning "下载失败（第 $i 次）：$($_.Exception.Message)，$($i * 15) 秒后重试"
            Start-Sleep -Seconds ($i * 15)
        }
    }
}
