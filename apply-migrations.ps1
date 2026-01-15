# Script para aplicar migrations do PostgreSQL
# Execute este script quando o PostgreSQL estiver acessivel

param(
    [string]$DbHost = "db.izyvctoikuxzmbwiyifo.supabase.co",
    [string]$Port = "5432",
    [string]$Database = "postgres",
    [string]$User = "postgres",
    [string]$Password = "9TKBZv9wBf4bmL2X"
)

Write-Host "[*] Aplicando Migrations do TradingBot..." -ForegroundColor Cyan
Write-Host ""

# Definir variavel de ambiente para senha
$env:PGPASSWORD = $Password

# Verificar se psql esta instalado
$psqlPath = Get-Command psql -ErrorAction SilentlyContinue

if (-not $psqlPath) {
    Write-Host "[!] ERRO: 'psql' nao encontrado no PATH" -ForegroundColor Red
    Write-Host ""
    Write-Host "[i] Opcoes:" -ForegroundColor Yellow
    Write-Host "1. Instalar PostgreSQL Client Tools"
    Write-Host "2. Usar pgAdmin ou outra ferramenta GUI"
    Write-Host "3. Aplicar manualmente via cliente do Supabase"
    Write-Host ""
    Write-Host "[*] Migrations a aplicar:"
    Write-Host "   - infra/postgres/migrations/002_wallets_and_verification.sql"
    Write-Host "   - infra/postgres/migrations/003_technical_analysis.sql"
    Write-Host ""
    exit 1
}

Write-Host "[+] psql encontrado em: $($psqlPath.Source)" -ForegroundColor Green
Write-Host ""

# Aplicar migration 002
Write-Host "[*] Aplicando 002_wallets_and_verification.sql..." -ForegroundColor Cyan
try {
    & psql -h $DbHost -p $Port -U $User -d $Database -f "infra/postgres/migrations/002_wallets_and_verification.sql"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Migration 002 aplicada com sucesso!" -ForegroundColor Green
    }
    else {
        Write-Host "[!] Migration 002 retornou codigo de saida: $LASTEXITCODE" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "[!] Erro ao aplicar migration 002: $_" -ForegroundColor Red
}
Write-Host ""

# Aplicar migration 003
Write-Host "[*] Aplicando 003_technical_analysis.sql..." -ForegroundColor Cyan
try {
    & psql -h $DbHost -p $Port -U $User -d $Database -f "infra/postgres/migrations/003_technical_analysis.sql"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Migration 003 aplicada com sucesso!" -ForegroundColor Green
    }
    else {
        Write-Host "[!] Migration 003 retornou codigo de saida: $LASTEXITCODE" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "[!] Erro ao aplicar migration 003: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "[+] Processo de migrations concluido!" -ForegroundColor Green

# Limpar variavel de ambiente
Remove-Item Env:\PGPASSWORD
