-- Roles enum + table (separate from profiles, per security best practice)
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- CEFR level enum
CREATE TYPE public.cefr_level AS ENUM ('A1','A2','B1','B2','C1','C2');
CREATE TYPE public.story_mode AS ENUM ('standard','stretch');
CREATE TYPE public.story_format AS ENUM ('news','short_story','novel_chapter','dialogue');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  default_level public.cefr_level NOT NULL DEFAULT 'A2',
  default_stretch BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Stories
CREATE TABLE public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  topic TEXT,
  level public.cefr_level NOT NULL,
  mode public.story_mode NOT NULL DEFAULT 'standard',
  stretch_level public.cefr_level,
  format public.story_format NOT NULL DEFAULT 'short_story',
  body TEXT NOT NULL,
  summary TEXT,
  word_count INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own stories" ON public.stories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own stories" ON public.stories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stories" ON public.stories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own stories" ON public.stories FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_stories_user_created ON public.stories(user_id, created_at DESC);

-- Story annotations (tokens + grammar) stored as JSONB for flexibility + one batched LLM write
CREATE TABLE public.story_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL UNIQUE REFERENCES public.stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tokens JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{i, surface, lemma, pos, translation, note?}]
  grammar JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, explanation, example_sentence, extra_examples[], complexity, is_stretch, token_indices[]}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.story_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own annotations" ON public.story_annotations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own annotations" ON public.story_annotations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own annotations" ON public.story_annotations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own annotations" ON public.story_annotations FOR DELETE USING (auth.uid() = user_id);

-- Vocab items (per user, deduped by lemma)
CREATE TABLE public.vocab_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lemma TEXT NOT NULL,
  pos TEXT,
  translation TEXT,
  notes TEXT,
  first_story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  first_seen_sentence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lemma)
);
ALTER TABLE public.vocab_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own vocab" ON public.vocab_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own vocab" ON public.vocab_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own vocab" ON public.vocab_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own vocab" ON public.vocab_items FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_vocab_user ON public.vocab_items(user_id);

-- SRS state (one row per vocab item; flexible — LLM can read these to bias future stories)
CREATE TABLE public.srs_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocab_id UUID NOT NULL UNIQUE REFERENCES public.vocab_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  interval_days NUMERIC NOT NULL DEFAULT 0,
  ease NUMERIC NOT NULL DEFAULT 2.5,
  reps INT NOT NULL DEFAULT 0,
  lapses INT NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.srs_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own srs" ON public.srs_reviews FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own srs" ON public.srs_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own srs" ON public.srs_reviews FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own srs" ON public.srs_reviews FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_srs_due ON public.srs_reviews(user_id, due_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_stories_updated BEFORE UPDATE ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile + default user role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();