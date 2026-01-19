#!/bin/bash

# Script para parar todos os serviços do TradingBot no Linux
# Execute: chmod +x stop-all.sh && ./stop-all.sh

echo "========================================"
echo "Parando Serviços do TradingBot"
echo "========================================"

# Procura e mata processos que estão rodando os serviços
# Filtramos por 'npm run dev' ou sub-processos do node nos diretórios do projeto
echo "Encerrando processos Node.js..."

# Uma forma segura é matar por nome do processo se forem os únicos na máquina
# ou procurar pelos diretórios específicos
pkill -f "api-gateway"
pkill -f "validator"
pkill -f "signal"
pkill -f "executor"
pkill -f "next-server"

# Caso o pkill falhe ou não pegue tudo, tentamos o comando geral
# pkill node # Descomente se quiser derrubar tudo que é node na máquina

echo "Verificando se ainda existem processos..."
ps aux | grep -E "api-gateway|validator|signal|executor|frontend" | grep -v grep

echo ""
echo "========================================"
echo "Serviços encerrados!"
echo "========================================"
