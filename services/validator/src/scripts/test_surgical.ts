
import { computeRiskAssessment, RiskComputationInput } from '../risk-scoring';

async function testRebalancedScoring() {
    console.log('🧪 Testando Reequilíbrio de Scoring (Sniping Mode) - Direct Function Test...');
    
    // Caso 1: SHIJIU (Simulado) - Fresh, Boa Liquidez, Top 1 > 20%
    console.log('\n--- CASO 1: SHIJIU (Fresh, $21k Liq, Whale < 10min) ---');
    const shijiuInput: RiskComputationInput = {
        token: { contract_address: 'E9iJJBUtYjXVhmPp3tNfHqWK2qNUyUKfhbZofecrpump', chain: 'SOLANA', symbol: 'SHIJIU' } as any,
        market: { 
            liquidityUsd: 21293, 
            fdvUsd: 21293, 
            volume24hUsd: 500,
            pairCreatedAt: Date.now() - (5 * 60 * 1000) // 5 minutos atrás
        },
        isHoneypot: false,
        liquidityLocked: false,
        holdersCount: 20,
        topHolders: [
            { address: 'Dev', percentage: 45 }, // Whale!
            { address: 'Pool', percentage: 10 }
        ] as any,
        security: {} as any
    };
    
    const shijiuResult = computeRiskAssessment(shijiuInput);
    console.log(`Score: ${shijiuResult.risk_score}`);
    console.log(`Razões: ${shijiuResult.indicators.rejectionReasons?.join(', ')}`);

    // Caso 2: Obvious Scam (Honeypot) - Deve continuar sendo 0
    console.log('\n--- CASO 2: Honeypot (Deve ser 0) ---');
    const honeyInput: RiskComputationInput = {
        token: { contract_address: 'scam123', chain: 'SOLANA', symbol: 'SCAM' } as any,
        market: { liquidityUsd: 5000, fdvUsd: 10000, volume24hUsd: 100 },
        isHoneypot: true,
        liquidityLocked: false,
        holdersCount: 5
    };
    const honeyResult = computeRiskAssessment(honeyInput);
    console.log(`Score: ${honeyResult.risk_score}`);

    // Caso 3: Old Whale (Moeda com > 30min e Dev com tudo) - Deve ser punida severamente
    console.log('\n--- CASO 3: Old Whale (>30min, Dev 45%) ---');
    const oldWhaleInput: RiskComputationInput = {
        token: { contract_address: 'oldwhale', chain: 'SOLANA', symbol: 'OLDW' } as any,
        market: { 
            liquidityUsd: 5000, 
            fdvUsd: 10000, 
            volume24hUsd: 100,
            pairCreatedAt: Date.now() - (60 * 60 * 1000) // 60 minutos atrás
        },
        isHoneypot: false,
        liquidityLocked: false,
        holdersCount: 15,
        topHolders: [{ address: 'Dev', percentage: 45 }] as any,
        security: {} as any
    };
    const oldWhaleResult = computeRiskAssessment(oldWhaleInput);
    console.log(`Score: ${oldWhaleResult.risk_score}`);
    console.log(`Razões: ${oldWhaleResult.indicators.rejectionReasons?.join(', ')}`);
}

testRebalancedScoring();
