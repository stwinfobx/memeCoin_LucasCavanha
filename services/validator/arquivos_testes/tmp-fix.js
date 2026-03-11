const fs = require('fs');
let c = fs.readFileSync('raw-api-test2.ts', 'utf8');
const lines = c.split('\n');

// Encontra linhas 354-379 (o bloco GoPlus antigo)
const start = lines.findIndex(l => l.includes('5. GOPLUS'));
let end = start;
// Busca o fechamento do bloco else { GoPlus sem dados... score -= 5; }
for (let i = start; i < lines.length; i++) {
    if (i > start && lines[i].includes('score -= 5;') && lines[i - 1].includes('warnings.push')) {
        // pega mais 1 linha (o fechamento })
        end = i + 1;
        break;
    }
}
console.log(`Substituindo linhas ${start + 1} a ${end + 1}`);
console.log('Primeira linha:', lines[start]);
console.log('Ultima linha:', lines[end]);

const NEW_LINES = `    // ── 5. GOPLUS (checagem completa EVM/Solana) ────────────────────────────
    const gp = goplus;
    const gpHasData = gp && !gp.error && Object.keys(gp).filter(k => k !== 'error').length > 2;

    if (gpHasData) {
        if (chain === 'Solana') {
            if (gp.freezeable === '1')  { issues.push('FREEZABLE');  score -= 40; }
            if (gp.mintable   === '1')  { issues.push('MINTABLE');   score -= 20; }
            if (gp.freezeable === '0' && gp.mintable === '0') { score += 15; }
        } else {
            // CRÍTICO
            if (gp.is_honeypot === '1')            { issues.push('HONEYPOT_GOPLUS');       score -= 55; }
            if (gp.cannot_sell_all === '1')         { issues.push('NAO_PODE_VENDER');       score -= 50; }
            if (gp.owner_change_balance === '1')    { issues.push('DONO_ALTERA_SALDO');     score -= 45; }
            if (gp.selfdestruct === '1')            { issues.push('SELF_DESTRUCT');          score -= 35; }
            if (gp.hidden_owner === '1')            { issues.push('OWNER_OCULTO');           score -= 30; }
            if (gp.transfer_pausable === '1')       { issues.push('TRANSFER_PAUSAVEL');      score -= 25; }
            if (gp.slippage_modifiable === '1')     { issues.push('SLIPPAGE_MODIFICAVEL');   score -= 20; }
            if (gp.can_take_back_ownership === '1') { issues.push('OWNER_PODE_RETOMAR');     score -= 20; }
            if (gp.is_proxy === '1')                { issues.push('CONTRATO_PROXY');          score -= 18; }
            if (gp.external_call === '1')           { issues.push('EXTERNAL_CALL');           score -= 15; }
            if (gp.is_mintable === '1')             { issues.push('MINTABLE');                score -= 15; }
            // MÉDIO
            if (gp.trading_cooldown === '1')        { warnings.push('Cooldown de trading');   score -= 10; }
            if (gp.anti_whale_modifiable === '1')   { warnings.push('Anti-whale modificável');score -=  8; }
            // TAXAS
            const buyTax  = parseFloat(gp.buy_tax  || '0');
            const sellTax = parseFloat(gp.sell_tax || '0');
            if (buyTax  > 0.30) { issues.push(\`TAXA_COMPRA_CRITICA:\${(buyTax*100).toFixed(0)}%\`);  score -= 30; }
            else if (buyTax  > 0.10) { issues.push(\`TAXA_COMPRA:\${(buyTax*100).toFixed(0)}%\`);    score -= 15; }
            else if (buyTax  > 0.05) { warnings.push(\`Taxa compra:\${(buyTax*100).toFixed(1)}%\`);  score -=  5; }
            if (sellTax > 0.30) { issues.push(\`TAXA_VENDA_CRITICA:\${(sellTax*100).toFixed(0)}%\`); score -= 30; }
            else if (sellTax > 0.10) { issues.push(\`TAXA_VENDA:\${(sellTax*100).toFixed(0)}%\`);    score -= 15; }
            else if (sellTax > 0.05) { warnings.push(\`Taxa venda:\${(sellTax*100).toFixed(1)}%\`);  score -=  5; }
            // HOLDERS
            const holders = parseInt(gp.holder_count || '0');
            if (holders === 0)     { issues.push('ZERO_HOLDERS');               score -= 20; }
            else if (holders < 5)  { issues.push(\`APENAS_\${holders}_HOLDERS\`);  score -= 15; }
            else if (holders < 20) { warnings.push(\`Poucos holders: \${holders}\`); score -=  5; }
            else { score += 5; }
            // CÓDIGO
            if (gp.is_open_source === '0') { warnings.push('CÓDIGO_FECHADO');  score -= 8; }
            else if (gp.is_open_source === '1') { score += 5; }
            if (gp.is_in_dex === '0') { warnings.push('FORA_DE_DEX'); score -= 5; }
            // BÔNUS: passou em todos os checks críticos
            const passedAll = gp.is_honeypot === '0'
                && gp.cannot_sell_all !== '1' && gp.hidden_owner !== '1'
                && gp.owner_change_balance !== '1' && gp.transfer_pausable !== '1'
                && gp.selfdestruct !== '1' && buyTax <= 0.05 && sellTax <= 0.05;
            if (passedAll) { score += 15; }
        }
    } else {
        // Sem dados do GoPlus = não pode atingir 80 pts (barreira de segurança)
        issues.push('SEM_DADOS_GOPLUS');
        score -= 20;
    }`.split('\n');

lines.splice(start, end - start + 1, ...NEW_LINES);
fs.writeFileSync('raw-api-test2.ts', lines.join('\n'), 'utf8');
console.log('✅ GoPlus scoring substituído! Total linhas:', lines.length);
