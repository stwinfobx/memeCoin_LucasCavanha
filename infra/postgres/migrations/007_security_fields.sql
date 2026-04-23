-- ============================================================
-- Migration 007: Security Fields on tokens table
-- Adds freeze_authority, mint_authority, buy_tax, sell_tax,
-- top_holder_1_pct and rugcheck_score as indexable columns.
-- These were previously buried in the `indicators` JSON blob.
-- ============================================================

ALTER TABLE tokens
  ADD COLUMN IF NOT EXISTS freeze_authority   VARCHAR(100)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS mint_authority     VARCHAR(100)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS buy_tax            DECIMAL(5,2)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sell_tax           DECIMAL(5,2)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS top_holder_1_pct   DECIMAL(5,2)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rugcheck_score     INTEGER        DEFAULT NULL;

COMMENT ON COLUMN tokens.freeze_authority IS 'NULL = renounced or EVM (no concept). Address string = active freeze authority.';
COMMENT ON COLUMN tokens.mint_authority   IS 'NULL = renounced or EVM. Address string = active mint authority.';
COMMENT ON COLUMN tokens.buy_tax          IS 'Buy tax percentage detected by GoPlus / Honeypot.is. NULL = not checked.';
COMMENT ON COLUMN tokens.sell_tax         IS 'Sell tax percentage detected by GoPlus / Honeypot.is. NULL = not checked.';
COMMENT ON COLUMN tokens.top_holder_1_pct IS 'Percentage of supply held by the largest single holder (from Helius or RugCheck).';
COMMENT ON COLUMN tokens.rugcheck_score   IS 'RugCheck risk score (0 = safe, 1000 = rugged). NULL = not checked or not Solana.';

-- Partial indexes for fast security filtering
CREATE INDEX IF NOT EXISTS idx_tokens_freeze_active
  ON tokens (freeze_authority)
  WHERE freeze_authority IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tokens_mint_active
  ON tokens (mint_authority)
  WHERE mint_authority IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tokens_top_holder
  ON tokens (top_holder_1_pct DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tokens_rugcheck_score
  ON tokens (rugcheck_score ASC NULLS LAST);
