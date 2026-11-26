-- CFI Academy V5.6 — persistent Robot Battle inventory.
-- Safe to rerun. Does not delete or alter existing student grades or accounts.
CREATE TABLE IF NOT EXISTS public.cfi_battle_inventory (
    user_id uuid NOT NULL REFERENCES public.cfi_users(id) ON DELETE CASCADE,
    item_key text NOT NULL CHECK (item_key IN ('laser','shield','turbo','plasma','repair','radar')),
    earned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,item_key)
);
CREATE INDEX IF NOT EXISTS cfi_battle_inventory_earned
    ON public.cfi_battle_inventory (earned_at DESC);
ALTER TABLE public.cfi_battle_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cfi_battle_inventory FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cfi_battle_inventory TO service_role;
-- No public RLS policy: inventory is read/written by authenticated CFI server only.
