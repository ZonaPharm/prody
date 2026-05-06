-- Add AI description instructions column to users table
alter table public.users add column if not exists ai_description_instructions text;
