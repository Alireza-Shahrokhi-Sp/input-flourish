-- Add cultural_notes column to story_annotations for Italian cultural color
-- (slang, proverbs, regional expressions, Gen Z language, cultural references).
-- Default empty array so existing rows are unaffected.
ALTER TABLE story_annotations
ADD COLUMN cultural_notes jsonb DEFAULT '[]'::jsonb;
