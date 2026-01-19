#!/bin/bash

# Script para instalar dependências no Linux
# Execute: chmod +x install-deps.sh && ./install-deps.sh

echo "========================================"
echo "Instalando Dependências do TradingBot"
echo "========================================"

# Lista de caminhos dos serviçosa
PROJECT_PATHS=(
    "services/api-gateway"
    "services/validator"
    "services/signal"
    "services/executor"
    "web/frontend"
)

ROOT_DIR=$(pwd)

for PATH_NAME in "${PROJECT_PATHS[@]}"; do
    if [ -d "$PATH_NAME" ]; then
        echo "----------------------------------------"
        echo "Entrando em: $PATH_NAME"
        
        cd "$ROOT_DIR/$PATH_NAME" || exit
        
        echo "Rodando npm install..."
        npm install
        
        if [ $? -eq 0 ]; then
            echo "Sucesso em $PATH_NAME!"
        else
            echo "ERRO: Falha ao instalar dependências em $PATH_NAME"
        fi
        
        cd "$ROOT_DIR" || exit
    else
        echo "AVISO: Caminho não encontrado: $PATH_NAME"
    fi
done

echo ""
echo "========================================"
echo "Instalacao concluida!"
echo "Agora voce pode rodar os servicos separadamente ou criar um script de start."
echo "========================================"
