# Script para iniciar todos os servicos do TradingBot localmente
# Execute: .\start-all.ps1

# ======================================================
# TradingBot - Start All Services
# Uso:  .\start-all.ps1
# ======================================================

$ErrorActionPreference = 'Stop'

function Resolve-RootDirectory {
    param (
        [string]$ScriptPath
    )

    if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
        return (Get-Location).Path
    }

    return (Split-Path -Parent $ScriptPath)
}

$scriptPath = $MyInvocation.MyCommand.Path
$rootDir = Resolve-RootDirectory -ScriptPath $scriptPath
$envFile = Join-Path $rootDir '.env'

Write-Host "========================================" -ForegroundColor DarkCyan
Write-Host "TradingBot :: Start All Services" -ForegroundColor Green
Write-Host "Root directory:" -NoNewline -ForegroundColor Gray
Write-Host " $rootDir" -ForegroundColor White

if (Test-Path $envFile) {
    Write-Host "Using environment file:" -NoNewline -ForegroundColor Gray
    Write-Host " $envFile" -ForegroundColor White
} else {
    Write-Warning "Arquivo .env nao encontrado na raiz. Variaveis padrão serão usadas."
}

$services = @(
    @{ Name = 'API Gateway';    Path = 'services\api-gateway'; Command = 'npm run dev'; Port = 4000; Color = 'Green' },
    @{ Name = 'Validator';      Path = 'services\validator';    Command = 'npm run dev'; Port = 4001; Color = 'Yellow' },
    @{ Name = 'Signal';         Path = 'services\signal';       Command = 'npm run dev'; Port = 4002; Color = 'Magenta' },
    @{ Name = 'Executor';       Path = 'services\executor';     Command = 'npm run dev'; Port = 4003; Color = 'Blue' },
    @{ Name = 'Frontend';       Path = 'web\frontend';          Command = 'npm run dev'; Port = 3000; Color = 'Cyan' }
)

function Start-ServiceWindow {
    param (
        [string]$Root,
        [hashtable]$Service
    )

    $serviceDir = Join-Path $Root $Service.Path
    if (-not (Test-Path $serviceDir)) {
        Write-Warning "Diretorio não encontrado para ${($Service.Name)}: $serviceDir"
        return
    }

    Write-Host "Iniciando ${($Service.Name)} (porta ${($Service.Port)})..." -ForegroundColor Cyan

    $commandLines = @(
        "Set-Location '$serviceDir'"
        "Write-Host '=== $($Service.Name) - Porta $($Service.Port) ===' -ForegroundColor $($Service.Color)"
        $Service.Command
    )

    $command = $commandLines -join '; '

    Start-Process powershell -ArgumentList @('-NoExit', '-Command', $command)
}

foreach ($service in $services) {
    Start-ServiceWindow -Root $rootDir -Service $service
    Start-Sleep -Seconds 2
}

Write-Host "" 
Write-Host "========================================" -ForegroundColor Green
Write-Host "Todos os serviços foram iniciados!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "" 
Write-Host "URLs:" -ForegroundColor Yellow
foreach ($service in $services) {
    if ($service.Port -gt 0) {
        Write-Host ("  - {0}: http://localhost:{1}" -f $service.Name, $service.Port) -ForegroundColor White
    }
}

Write-Host "" 
Write-Host "Para encerrar, feche as janelas abertas do PowerShell." -ForegroundColor Yellow
Write-Host "Pressione qualquer tecla para sair..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
