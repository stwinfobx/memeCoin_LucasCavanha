
import { Pool } from 'pg';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

import { heliusClient } from '../providers/helius';

async function testHelius() {
    const address = '6p6xgHyY7vMtAsVvYAn9e6U3V3SgXn8T5XG6Wqypump';
    console.log(`--- TESTING HELIUS DIRECTLY FOR ${address} ---`);
    
    try {
        const meta = await heliusClient.getTokenMetadata(address);
        console.log('Metadata:', JSON.stringify(meta, null, 2));
        
        const holders = await heliusClient.getHoldersCount(address);
        console.log('Holders Count:', holders);
        
        const mintAuth = await heliusClient.getMintAuthority(address);
        console.log('Mint Auth:', JSON.stringify(mintAuth, null, 2));
    } catch (err: any) {
        console.error('Helius Error:', err.message);
    }
}

testHelius();
