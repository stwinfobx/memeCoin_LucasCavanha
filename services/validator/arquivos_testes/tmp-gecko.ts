import axios from 'axios';

async function testDex(pool: string) {
    try {
        const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${pool}`;
        const res = await axios.get(url, { headers: { 'Accept': 'application/json' } });
        console.log("Achou no DexScreener:");
        if (res.data?.pairs) {
            console.log(JSON.stringify(res.data.pairs[0], null, 2));
        } else {
            console.log(res.data);
        }
    } catch (e: any) {
        console.error("Dex erro:", e.message);
    }
}
testDex('uudmvq9mdtwgl3qlfu37m14gcvfnqhygw9jxhmhwrr2');
