ALTER TABLE public.stories
  ADD COLUMN parent_story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL;
CREATE INDEX idx_stories_parent ON public.stories(parent_story_id);