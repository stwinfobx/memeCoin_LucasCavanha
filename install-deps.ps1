# Script para instalar todas a dependências do TradingBot
# Execute: .\install-deps.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Instalando Dependencias do TradingBot" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Lista de caminhos dos serviços
$projectPaths = @(
    "services\api-gateway",
    "services\validator",
    "services\signal",
    "services\executor",
    "web\frontend"
)

$rootDir = Get-Location

foreach ($path in $projectPaths) {
    $fullPath = Join-Path $rootDir $path
    
    if (Test-Path $fullPath) {
        Write-Host "----------------------------------------" -ForegroundColor Gray
        Write-Host "Entrando em: $path" -ForegroundColor Yellow
        
        Set-Location $fullPath
        
        Write-Host "Rodando npm install..." -ForegroundColor Cyan
        npm install
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Sucesso em $path!" -ForegroundColor Green
        }
        else {
            Write-Error "Falha ao instalar dependencias em $path"
        }
        
        Set-Location $rootDir
    }
    else {
        Write-Warning "Caminho nao encontrado: $path"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Instalacao concluida!" -ForegroundColor Green
Write-Host "Agora voce pode rodar: .\start-all.ps1" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
