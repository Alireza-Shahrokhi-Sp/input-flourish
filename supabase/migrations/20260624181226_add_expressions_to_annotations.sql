-- Add expressions column to story_annotations for LLM-detected multi-word expressions
-- (idioms, phrasal verbs, collocations, fixed expressions).
-- Default empty array so existing rows are unaffected.
ALTER TABLE story_annotations
ADD COLUMN expressions jsonb DEFAULT '[]'::jsonb;
