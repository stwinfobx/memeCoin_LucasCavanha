
import { computeRiskAssessment, RiskComputationInput } from '../risk-scoring';

async function testDebugRealToken() {
    console.log('🧪 Debugging Real Token from Report: 5LEGDOG');
    
    const input: RiskComputationInput = {
        token: { contract_address: 'GJkqQTBpq194T4SEMtAwuTp37SMt3nPdQvMEnZajkvC3', chain: 'SOLANA', symbol: '5LEGDOG' } as any,
        market: { 
            liquidityUsd: 2527.02, 
            fdvUsd: 2527.02, 
            volume24hUsd: 0,
            pairCreatedAt: Date.now() - (2 * 60 * 1000) // 2 minutos atrás
        },
        isHoneypot: false,
        liquidityLocked: false,
        holdersCount: 3,
        topHolders: [
            { address: 'Dev', percentage: 95 }, // Most likely whale
        ] as any,
        security: { 
            verdict: 'safe', 
            isHoneypot: false, 
            buyTax: 0, 
            sellTax: 0, 
            riskScore: 0,
            sources: { 
                rugcheck: { score: 900, verdict: 'danger' }, // RugCheck is usually very high for fresh pumpfun
                goplus: { checked: true, isHoneypot: false } 
            },
            issues: []
        } as any
    };
    
    const result = computeRiskAssessment(input);
    console.log('\n--- RESULTADO DA DEPURAÇÃO ---');
    console.log(`Score Final: ${result.risk_score}`);
    console.log(`Rejection Reasons: ${result.indicators.rejectionReasons?.join(', ')}`);
}

testDebugRealToken();
