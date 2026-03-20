
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function diagnose() {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'mulack.zuguenberg@gmail.com';
        console.log('--- Diagnosis Start ---');
        console.log('ADMIN_EMAIL from env:', adminEmail);
        console.log('BOT_DEPOSIT_ADDRESS:', process.env.BOT_DEPOSIT_ADDRESS);

        const users = await pool.query('SELECT id, email FROM users');
        console.log('Users in DB:', users.rows);

        const adminUser = users.rows.find(u => u.email.toLowerCase() === adminEmail.toLowerCase());
        if (adminUser) {
            console.log('Admin user found in DB with ID:', adminUser.id);

            const profile = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [adminUser.id]);
            console.log('Admin profile:', profile.rows[0]);

            const ledger = await pool.query('SELECT entry_type, amount_usd, description FROM ledger_entries WHERE user_id = $1', [adminUser.id]);
            console.log('Admin ledger entries:', ledger.rows);
        } else {
            console.log('Admin user NOT FOUND in DB with email:', adminEmail);
        }

        console.log('--- Diagnosis End ---');
    } catch (error) {
        console.error('Diagnosis failed:', error);
    } finally {
        await pool.end();
    }
}

diagnose();
