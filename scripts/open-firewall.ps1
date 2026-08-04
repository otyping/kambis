# open-firewall.ps1 — เปิดพอร์ตให้เครื่องอื่นในออฟฟิศเข้าดู Dashboard ได้
#
# ต้องรันด้วยสิทธิ์ผู้ดูแลระบบ:
#   คลิกขวาที่ไฟล์นี้ → Run with PowerShell   (ถ้าไม่ผ่านให้เปิด PowerShell แบบ
#   Run as administrator แล้วสั่ง  powershell -ExecutionPolicy Bypass -File <path>)
#
# กฎถูกจำกัดไว้ที่ -RemoteAddress LocalSubnet คือเข้าได้เฉพาะเครื่องในวง LAN เดียวกัน
# ไม่ได้เปิดออกอินเทอร์เน็ต
#
# ยกเลิกภายหลัง:  Remove-NetFirewallRule -DisplayName "Kambis Dashboard (5173)"

$ErrorActionPreference = 'Stop'
$RuleName = 'Kambis Dashboard (5173)'
$Port = 5173

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ''
    Write-Host '  ต้องรันด้วยสิทธิ์ผู้ดูแลระบบ' -ForegroundColor Yellow
    Write-Host '  กำลังขอสิทธิ์ — กด Yes ในหน้าต่างที่เด้งขึ้นมา' -ForegroundColor Yellow
    Write-Host ''
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', $PSCommandPath
    )
    return
}

Write-Host ''
Write-Host "  รันด้วยสิทธิ์ผู้ดูแลระบบแล้ว ($(whoami))" -ForegroundColor Green

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  มีกฎ '$RuleName' อยู่แล้ว — ลบของเดิมก่อน"
    Remove-NetFirewallRule -DisplayName $RuleName
}

try {
    New-NetFirewallRule -DisplayName $RuleName `
        -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow `
        -Profile Domain, Private -RemoteAddress LocalSubnet | Out-Null

    Write-Host "  สร้างกฎเรียบร้อย — เปิดพอร์ต $Port ให้เฉพาะเครื่องในวง LAN เดียวกัน" -ForegroundColor Green
}
catch {
    Write-Host "  สร้างกฎไม่สำเร็จ: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host '  ถ้าขึ้นว่าถูกนโยบายองค์กรปิดไว้ ต้องให้ฝ่าย IT เปิดพอร์ตนี้ให้' -ForegroundColor Red
    return
}

Write-Host ''
Write-Host '  ── ตรวจผล ──'
Get-NetFirewallRule -DisplayName $RuleName |
    Select-Object DisplayName, Enabled, Direction, Action, Profile |
    Format-List

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
       Select-Object -First 1).IPAddress

Write-Host "  ลิงก์สำหรับเครื่องอื่น:  http://${ip}:$Port" -ForegroundColor Cyan
Write-Host ''
