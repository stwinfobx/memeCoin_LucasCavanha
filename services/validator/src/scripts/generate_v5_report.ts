
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import '../env';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function generateV5Report() {
  console.log('📊 Gerando Relatório de Validação V5 (Pós-Soft Retry)...');
  
  try {
    const query = `
      SELECT 
        t.symbol, 
        t.name, 
        t.chain,
        t.contract_address,
        t.liquidity_usd, 
        t.holders_count, 
        t.safety_score, 
        t.is_honeypot,
        t.validated_at,
        tra.risk_level,
        tra.indicators->>'rejectionReasons' as rejection_reasons,
        tra.indicators->>'securityVerdict' as security_verdict,
        s.signal_type as ai_signal
      FROM tokens t
      LEFT JOIN token_risk_assessments tra ON t.id = tra.token_id
      LEFT JOIN signals s ON t.id = s.token_id
      WHERE t.validated_at > NOW() - INTERVAL '1 hour'
      ORDER BY t.validated_at DESC
      LIMIT 100;
    `;

    const result = await pool.query(query);
    const reportPath = path.join(__dirname, '../../analyzed_tokens_v5_report.json');
    
    fs.writeFileSync(reportPath, JSON.stringify(result.rows, null, 2));
    
    console.log(`✅ Relatório V5 gerado com sucesso: ${result.rows.length} tokens processados.`);
    console.log(`📍 Caminho: ${reportPath}`);
    
    // Sumário rápido no console
    const highScores = result.rows.filter(r => r.safety_score >= 70);
    console.log(`📈 Moedas com Score >= 70: ${highScores.length}`);
    if (highScores.length > 0) {
      console.table(highScores.map(h => ({ 
        symbol: h.symbol, 
        score: h.safety_score, 
        liq: h.liquidity_usd, 
        signal: h.ai_signal 
      })));
    }

  } catch (error) {
    console.error('❌ Erro ao gerar relatório V5:', error);
  } finally {
    await pool.end();
  }
}

generateV5Report();
