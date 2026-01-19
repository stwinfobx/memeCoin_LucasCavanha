#!/bin/bash

# Script para iniciar todos os serviços no Linux
# Execute: chmod +x start-all.sh && ./start-all.sh

echo "========================================"
echo "Iniciando Servicos do TradingBot"
echo "========================================"

# Carregar .env se existir
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
    echo "Variaveis de ambiente carregadas do .env"
fi

ROOT_DIR=$(pwd)

# Função para iniciar serviço em background
start_service() {
    NAME=$1
    DIR=$2
    PORT=$3
    
    echo "Iniciando $NAME na porta $PORT..."
    cd "$ROOT_DIR/$DIR" || return
    npm run dev > "$ROOT_DIR/log_$NAME.log" 2>&1 &
    echo "$NAME iniciado (logs em log_$NAME.log)"
    cd "$ROOT_DIR" || return
}

start_service "api-gateway" "services/api-gateway" 4000
sleep 2
start_service "validator" "services/validator" 4001
sleep 2
start_service "signal" "services/signal" 4002
sleep 2
start_service "executor" "services/executor" 4003
sleep 2
start_service "frontend" "web/frontend" 3000

echo ""
echo "========================================"
echo "Todos os servicos foram disparados!"
echo "Use 'ps aux | grep node' para ver os processos."
echo "Logs disponiveis em log_*.log"
echo "========================================"
