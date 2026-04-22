-- Extend vocab_items
ALTER TABLE public.vocab_items
  ADD COLUMN IF NOT EXISTS theme_tag text,
  ADD COLUMN IF NOT EXISTS cefr_level text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'learning';

-- Extend stories
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS target_word_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS theme_tag text;

CREATE INDEX IF NOT EXISTS idx_vocab_theme ON public.vocab_items(user_id, theme_tag);
CREATE INDEX IF NOT EXISTS idx_srs_due ON public.srs_reviews(user_id, due_at);