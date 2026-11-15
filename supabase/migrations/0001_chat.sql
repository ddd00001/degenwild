-- Public chat. Anyone can read; only the `chat` edge function (service role) can write.
create table public.chat_messages (
  id bigint generated always as identity primary key,
  wallet text not null check (char_length(wallet) between 32 and 44),
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);
create index chat_messages_wallet_id on public.chat_messages (wallet, id desc);

alter table public.chat_messages enable row level security;
create policy "chat is public to read" on public.chat_messages for select to anon, authenticated using (true);
revoke insert, update, delete on public.chat_messages from anon, authenticated;

alter publication supabase_realtime add table public.chat_messages;
