
const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, '../analyzed_tokens_report.json');

if (!fs.existsSync(reportPath)) {
  console.error('Report not found!');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

console.log(`Total tokens analyzed: ${data.length}`);

const approved = data.filter(t => t.safety_score >= 50);
console.log(`Approved (Score >= 50): ${approved.length}`);

const honeypots = data.filter(t => t.is_honeypot);
console.log(`Honeypots detected: ${honeypots.length}`);

const byChain = data.reduce((acc, t) => {
  acc[t.chain] = (acc[t.chain] || 0) + 1;
  return acc;
}, {});
console.log('Tokens by chain:', byChain);

console.log('\nTop 10 Approved Tokens:');
approved.sort((a, b) => b.safety_score - a.safety_score).slice(0, 10).forEach(t => {
  console.log(`- ${t.symbol} (${t.name}): Score ${t.safety_score}, Chain ${t.chain}, Liquidity: $${t.liquidity_usd}`);
});

// Analyze indicators for some failed ones
console.log('\nCommon issues in failed tokens (last 10):');
data.filter(t => t.safety_score < 50).slice(0, 10).forEach(t => {
  const indicators = t.indicators || {};
  const issues = Object.entries(indicators)
    .filter(([k, v]) => v && typeof v === 'object' && v.verdict === 'danger')
    .map(([k]) => k);
  console.log(`- ${t.symbol}: Score ${t.safety_score}, Issues: ${issues.join(', ') || 'N/A'}`);
});
