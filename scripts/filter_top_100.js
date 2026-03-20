
const fs = require('fs');
const path = require('path');

const reportPath = path.join(__dirname, '../analyzed_tokens_report.json');
const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

// Filter top 100 by safety score
const top100 = data
  .sort((a, b) => b.safety_score - a.safety_score)
  .slice(0, 100);

const outputPath = path.join(__dirname, '../top_100_tokens_report.json');
fs.writeFileSync(outputPath, JSON.stringify(top100, null, 2));

console.log(`Top 100 report saved to ${outputPath}`);
