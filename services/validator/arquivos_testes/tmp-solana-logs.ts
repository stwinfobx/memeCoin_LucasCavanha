import { Connection, PublicKey } from '@solana/web3.js';

const rpc = 'https://mainnet.helius-rpc.com/?api-key=c0e8b22b-7ba2-425a-b501-83ce58400f19';
const ws = 'wss://mainnet.helius-rpc.com/?api-key=c0e8b22b-7ba2-425a-b501-83ce58400f19';

const conn = new Connection(rpc, { wsEndpoint: ws });

console.log('Testing Pump.fun Fee Account WebSocket...');

const feeAccount = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
conn.onLogs(feeAccount, (logs) => {
    if (logs.err) return;
    console.log('Received fee account tx:', logs.signature);
    process.exit(0);
}, 'confirmed');

setTimeout(() => {
    console.log('Timeout 10s!');
    process.exit(1);
}, 10000);
