# start-dashboard.ps1 — เปิดเซิร์ฟเวอร์ด้วยมือ (ตัวที่ START-DASHBOARD.bat เรียก)
#
# แยกออกจากไฟล์ .bat เพราะ batch อ่านภาษาไทยเพี้ยนง่ายมาก (ขึ้นกับ codepage
# ของเครื่อง) ส่วน PowerShell อ่าน UTF-8 ได้ตรง ๆ ไฟล์ .bat จึงเหลือแต่ ASCII
#
# เรียกผ่าน Task Scheduler ไม่ใช่ node ตรง ๆ เพราะ Task Scheduler รันโปรเซส
# แยกจากหน้าต่างนี้ — ปิดหน้าต่างแล้วเซิร์ฟเวอร์ยังทำงานต่อ

$ErrorActionPreference = 'Stop'
$TaskName = 'Kambis Dashboard'
$Port = 5173

Write-Host ''
Write-Host '  Kambis Executive Report Dashboard' -ForegroundColor Green
Write-Host '  ─────────────────────────────────'
Write-Host ''

# เก็บกวาดของค้างจากรอบก่อนเสมอ — ถ้าไม่ทำจะชนพอร์ตแล้วเปิดไม่ขึ้น
Write-Host '  เก็บกวาดของค้างจากรอบก่อน...'
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}

$me = $PID
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -like '*Kambis*start-server*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 3

Write-Host '  กำลังเปิดเซิร์ฟเวอร์...'
try {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
}
catch {
    Write-Host ''
    Write-Host "  สั่งเปิดไม่สำเร็จ: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  ตรวจว่ามี Task ชื่อ `"$TaskName`" อยู่หรือไม่ (เปิด Task Scheduler ดู)" -ForegroundColor Red
    Write-Host ''
    return
}

# รอให้ผูกพอร์ต — เช็คทุกวินาทีแทนการรอเฉย ๆ จะได้ไม่ต้องรอเผื่อนาน
$up = $false
foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
}

Write-Host ''
if (-not $up) {
    Write-Host '  ยังเปิดไม่ขึ้นภายใน 30 วินาที' -ForegroundColor Yellow
    Write-Host '  ดูสาเหตุได้ที่  data\logs\server-err.log  หรือ  data\logs\crash-*.log'
    Write-Host ''
    return
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
       Select-Object -First 1).IPAddress

Write-Host '  เปิดเรียบร้อยแล้ว' -ForegroundColor Green
Write-Host ''
Write-Host '     เครื่องนี้           http://localhost:5173' -ForegroundColor Cyan
if ($ip) { Write-Host "     เครื่องอื่นในออฟฟิศ   http://${ip}:$Port" -ForegroundColor Cyan }
Write-Host ''
Write-Host '  ครั้งแรกที่เปิดหน้าเว็บจะใช้เวลาโหลดข้อมูลสักครู่ (ดึงจาก Google 266 ชีตย่อย)' -ForegroundColor DarkGray
Write-Host '  ปิดหน้าต่างนี้ได้เลย เซิร์ฟเวอร์ทำงานต่อในเบื้องหลัง' -ForegroundColor DarkGray
Write-Host ''
