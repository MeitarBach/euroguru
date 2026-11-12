-- The Watch Room chat is open any time.
--
-- Until now post_message took messages only from an hour before a tip-off until an hour
-- after the game (public.chat_open). Members can now post whenever they like. The rest
-- of the checks stay: signed in, a team in the room (or its admin), one message per 2
-- seconds. If the chat gets out of hand, the hours can come back.
--
-- room_board still returns `chat` (public.chat_window), for the app build that was live
-- when this ran - it shows the message box only inside those hours. The app from this
-- change on doesn't read it.

create or replace function public.post_message(rid uuid, body text)
returns public.room_messages
language plpgsql security definer set search_path = ''
as $$
declare
    me uuid := (select auth.uid());
    msg public.room_messages;
begin
    if me is null then
        raise exception 'Sign in to chat' using errcode = '42501';
    end if;
    if not (private.is_room_member(rid) or private.is_room_admin(rid)) then
        raise exception 'Bring a team into this room to chat' using hint = 'not_member';
    end if;
    perform pg_advisory_xact_lock(hashtext('chat:' || me::text));
    if exists (select 1 from public.room_messages
               where author = me and created_at > now() - interval '2 seconds') then
        raise exception 'Slow down a little' using hint = 'too_fast';
    end if;
    insert into public.room_messages (room_id, author, nickname, body)
    values (rid, me, coalesce((select nickname from public.profiles where user_id = me), 'Player'), btrim(body))
    returning * into msg;
    return msg;
end;
$$;

drop function public.chat_open();

comment on table public.fixtures is
    'Every game''s tip-off and clubs, for the round''s lineup rules. Written by the data run (utils.rounds), read by everyone.';
