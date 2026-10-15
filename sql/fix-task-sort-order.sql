-- Task ordering uses millisecond timestamps, which exceed a 32-bit integer.
ALTER TABLE public.tasks ALTER COLUMN sort_order TYPE bigint;
NOTIFY pgrst, 'reload schema';
