const { heliusClient } = require('./src/providers/helius');

async function test() {
  const mint = 'Dvwn2DKwyQUerezQJaa5FfYU7qPU76eZVRFWhDt5pump'; // Sample from report
  console.log('Testing Helius for:', mint);
  
  const holders = await heliusClient.getTopHolders(mint);
  console.log('Holders:', JSON.stringify(holders, null, 2));
  
  const auth = await heliusClient.getMintAuthority(mint);
  console.log('Mint Authority:', JSON.stringify(auth, null, 2));
  
  const count = await heliusClient.getHoldersCount(mint);
  console.log('Total Holders Count:', count);
}

test();
