# Install all missing dependencies for TradingBot services
# Execute: .\install-deps.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Installing TradingBot Dependencies" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$services = @(
    @{ 
        Name     = "API Gateway"
        Path     = "services\api-gateway"
        Packages = "@sendgrid/mail", "ethers"
    },
    @{ 
        Name     = "Validator"
        Path     = "services\validator"
        Packages = "@solana/web3.js", "@solana/spl-token"
    },
    @{ 
        Name     = "Signal"
        Path     = "services\signal"
        Packages = @()  # No new packages needed
    },
    @{ 
        Name     = "Executor"
        Path     = "services\executor"
        Packages = "@solana/web3.js", "@solana/spl-token", "ethers"
    }
)

foreach ($service in $services) {
    if ($service.Packages.Count -eq 0) {
        Write-Host "Skipping $($service.Name) - no new packages needed" -ForegroundColor Gray
        continue
    }

    Write-Host "Installing packages for $($service.Name)..." -ForegroundColor Yellow
    Set-Location $service.Path
    
    $packagesStr = $service.Packages -join " "
    Write-Host "  npm install $packagesStr" -ForegroundColor Gray
    
    npm install $service.Packages
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Success!" -ForegroundColor Green
    }
    else {
        Write-Host "  Failed!" -ForegroundColor Red
    }
    
    Set-Location ..\..
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Now run: .\start-all.ps1" -ForegroundColor Cyan
