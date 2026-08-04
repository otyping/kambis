# start-server.ps1 — ตัวเปิดเซิร์ฟเวอร์ที่ Task Scheduler เรียกใช้
#
# แยกเป็นไฟล์เพราะ Task Scheduler ต้องการคำสั่งเดียวที่ทำงานจบในตัว
# และต้อง cd เข้าโฟลเดอร์โปรเจกต์ก่อน ไม่งั้นหา config/sources.json ไม่เจอ
#
# สคริปต์นี้ "ไม่จบ" โดยตั้งใจ — มันคุมเซิร์ฟเวอร์ไว้ ถ้าเซิร์ฟเวอร์ดับจะเปิดใหม่ให้เอง

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $ProjectDir 'data\logs'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
# log ของ node เขียนทับทุกครั้งที่เปิดใหม่ (Start-Process ต่อท้ายไม่ได้)
# ส่วนประวัติการเปิด/ดับเก็บแยกไว้อีกไฟล์ ไม่งั้นสองฝั่งแย่งเขียนไฟล์เดียวกัน
$OutLog = Join-Path $LogDir 'server-out.log'
$ErrLog = Join-Path $LogDir 'server-err.log'
$SupLog = Join-Path $LogDir 'supervisor.log'

Set-Location $ProjectDir

function Write-Sup([string]$msg) {
    # ตัดท่อนเก่าทิ้งถ้าบวมเกิน 2 MB ปล่อยไว้จะกินดิสก์ไปเรื่อย ๆ
    if ((Test-Path $SupLog) -and ((Get-Item $SupLog).Length -gt 2MB)) {
        Get-Content $SupLog -Tail 300 | Set-Content "$SupLog.tmp" -Encoding utf8
        Move-Item "$SupLog.tmp" $SupLog -Force
    }
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg" | Out-File $SupLog -Append -Encoding utf8
}

Write-Sup 'เริ่มตัวคุมเซิร์ฟเวอร์'

# วนคุมไว้: ถ้า node ดับด้วยเหตุใดก็ตาม รอแล้วเปิดใหม่
$fails = 0
while ($true) {
    $started = Get-Date

    $proc = Start-Process -FilePath 'node' -ArgumentList 'server/server.js' `
        -WorkingDirectory $ProjectDir `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog `
        -WindowStyle Hidden -PassThru

    Write-Sup "เปิดเซิร์ฟเวอร์ PID $($proc.Id)"
    $proc.WaitForExit()

    $alive = (Get-Date) - $started
    Write-Sup "หยุดทำงาน (exit $($proc.ExitCode)) หลังรันมา $([math]::Round($alive.TotalMinutes,1)) นาที"

    # ถ้าดับเร็วติดกันหลายครั้ง แปลว่าเปิดไม่ขึ้นจริง ๆ (เช่นพอร์ตถูกใช้ หรือ config พัง)
    # การวนเปิดรัว ๆ มีแต่จะถมดิสก์ด้วย log จึงถอยให้ห่างขึ้นเรื่อย ๆ
    if ($alive.TotalSeconds -lt 30) { $fails++ } else { $fails = 0 }
    $wait = [math]::Min(10 * [math]::Pow(2, $fails), 300)
    if ($fails -ge 5) { Write-Sup "เปิดไม่ขึ้น $fails ครั้งติด — ตรวจ server-err.log" }

    Start-Sleep -Seconds $wait
}
