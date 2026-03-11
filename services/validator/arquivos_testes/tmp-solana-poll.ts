import { Connection, PublicKey } from '@solana/web3.js';

const rpc = 'https://mainnet.helius-rpc.com/?api-key=c0e8b22b-7ba2-425a-b501-83ce58400f19';
const conn = new Connection(rpc);
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfX9PNnZz4n9n9fpxc6');

async function poll() {
    try {
        const sigs = await conn.getSignaturesForAddress(PUMP, { limit: 10 });
        console.log(`Polled ${sigs.length} sigs! First:`, sigs[0].signature);
    } catch (e: any) {
        console.error(e.message);
    }
}

poll();
