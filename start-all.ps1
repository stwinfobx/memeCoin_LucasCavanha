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
}
else {
    Write-Warning "Arquivo .env nao encontrado na raiz. Variaveis padrão serao usadas."

    # ============================================
    # VARIAVEIS DE AMBIENTE PADRAO
    # ============================================
    Write-Host "Configurando variaveis de ambiente padrao..." -ForegroundColor Cyan

    # Database
    $env:DATABASE_URL = "postgresql://botuser:botpass@localhost:5433/tradingbot"
    $env:POSTGRES_HOST = "localhost"
    $env:POSTGRES_PORT = "5433"
    $env:POSTGRES_DB = "tradingbot"
    $env:POSTGRES_USER = "botuser"
    $env:POSTGRES_PASSWORD = "botpass"

    # Security & Encryption
    $env:JWT_SECRET = "your-super-secret-jwt-key-change-in-production-min-32-chars"
    $env:ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    # Email (SendGrid)
    $env:SENDGRID_API_KEY = "SG.YOUR_SENDGRID_API_KEY_HERE"
    $env:EMAIL_FROM = "noreply@tradingbot.ai"
    $env:FRONTEND_URL = "http://localhost:3000"

    # Solana
    $env:SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"
    $env:SOLSCAN_API_KEY = "YOUR_SOLSCAN_API_KEY_HERE"

    # Blockchain - BSC
    $env:BSC_RPC_URL = "https://bsc-dataseed.binance.org/"
    $env:PANCAKESWAP_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
    $env:WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

    # Bot Configuration
    $env:BOT_EXECUTION_MODE = "simulation"
    $env:PRICE_COLLECTION_MINUTES = "1"
    $env:AUTO_ANALYZE_INTERVAL_MINUTES = "5"

    Write-Host "Variaveis padrao configuradas!" -ForegroundColor Green
}

$services = @(
    @{ Name = 'API Gateway'; Path = 'services\api-gateway'; Command = 'npm run dev'; Port = 4000; Color = 'Green' },
    @{ Name = 'Validator'; Path = 'services\validator'; Command = 'npm run dev'; Port = 4001; Color = 'Yellow' },
    @{ Name = 'Signal'; Path = 'services\signal'; Command = 'npm run dev'; Port = 4002; Color = 'Magenta' },
    @{ Name = 'Executor'; Path = 'services\executor'; Command = 'npm run dev'; Port = 4003; Color = 'Blue' },
    @{ Name = 'Frontend'; Path = 'web\frontend'; Command = 'npm run dev'; Port = 3000; Color = 'Cyan' }
)

function Start-ServiceWindow {
    param (
        [string]$Root,
        [hashtable]$Service
    )

    $serviceDir = Join-Path $Root $Service.Path
    if (-not (Test-Path $serviceDir)) {
        Write-Warning "Diretorio nao encontrado para $($Service.Name): $serviceDir"
        return
    }

    Write-Host "Iniciando $($Service.Name) (porta $($Service.Port))..." -ForegroundColor Cyan

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
Write-Host "Todos os servicos foram iniciados!" -ForegroundColor Green
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
