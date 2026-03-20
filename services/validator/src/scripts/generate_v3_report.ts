
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Carregar .env do diretório raiz
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

async function generateReportV3() {
    console.log('📊 Gerando analyzed_tokens_v3_report.json...');
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // Buscar os últimos 100 tokens validados hoje
        const query = `
            SELECT 
                t.*,
                s.signal_type as AI_signal,
                s.id as signal_id
            FROM tokens t
            LEFT JOIN signals s ON t.id = s.token_id
            WHERE t.validated_at >= CURRENT_DATE
            ORDER BY t.validated_at DESC
            LIMIT 100
        `;
        
        const result = await pool.query(query);
        const tokens = result.rows;

        const reportPath = path.join(__dirname, '../../analyzed_tokens_v3_report.json');
        fs.writeFileSync(reportPath, JSON.stringify(tokens, null, 2));

        console.log(`✅ Relatório V3 gerado com sucesso: ${reportPath}`);
        console.log(`📝 Total de tokens no relatório: ${tokens.length}`);
    } catch (error: any) {
        console.error('❌ Erro ao gerar relatório V3:', error.message);
    } finally {
        await pool.end();
    }
}

generateReportV3();
