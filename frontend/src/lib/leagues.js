import { db } from './db';

/**
 * Teams, leagues and round locks, stored in Supabase.
 *
 * The rules live in the database (supabase/migrations/*_teams_and_leagues.sql): row
 * security keeps a team private to its owner, a trigger refuses lineup changes while a
 * round is on, and leagues are joined and read only through RPCs that check membership.
 * This module is the thin client for it. Every function throws on failure, with the
 * database's message and its `hint` (locked, team_cap, league_full, bad_invite,
 * not_found) on the error so the UI can say the right thing.
 */

export const TEAM_LIMIT = 5;
export const STARTERS = 5;
export const BENCH = 5;
export const LEAGUE_LIMIT = 30;
export const EMPTY_LINEUP = Object.freeze({ keys: [], bench: [], captain: null, coach: null });

const TEAM_COLUMNS = 'id, name, lineup, share_slug, created_at';

function fail(error) {
    const e = new Error(error?.message || 'Something went wrong');
    e.hint = error?.hint ?? null;
    e.code = error?.code ?? null;
    throw e;
}

async function run(query) {
    if (!db) fail({ message: 'Accounts are not available in this build' });
    const { data, error } = await query;
    if (error) fail(error);
    return data;
}

/** A lineup in the shape the database accepts: known keys only, roles kept consistent. */
export function cleanLineup(lineup = EMPTY_LINEUP) {
    const keys = [...new Set((lineup.keys ?? []).filter(k => typeof k === 'string' && /^id:\d+$/.test(k)))];
    const bench = [...new Set((lineup.bench ?? []).filter(k => keys.includes(k)))];
    const captain = keys.includes(lineup.captain) && !bench.includes(lineup.captain) ? lineup.captain : null;
    const coach = typeof lineup.coach === 'string' && /^coach:\d+$/.test(lineup.coach) ? lineup.coach : null;
    return { keys, bench, captain, coach };
}

// ---------------------------------------------------------------------------- teams

export const listTeams = () =>
    run(db.from('teams').select(TEAM_COLUMNS).order('created_at'));

export const createTeam = (name, lineup = EMPTY_LINEUP) =>
    run(db.from('teams').insert({ name, lineup: cleanLineup(lineup) }).select(TEAM_COLUMNS).single());

export const saveLineup = (id, lineup) =>
    run(db.from('teams').update({ lineup: cleanLineup(lineup) }).eq('id', id).select(TEAM_COLUMNS).single());

export const renameTeam = (id, name) =>
    run(db.from('teams').update({ name }).eq('id', id).select(TEAM_COLUMNS).single());

export const deleteTeam = (id) => run(db.from('teams').delete().eq('id', id));

// --------------------------------------------------------------------------- rounds

/** Every round's lock window for a season, oldest first. Readable signed out. */
export const listRounds = (season) =>
    run(db.from('rounds').select('round, lock_at, unlock_at').eq('season', Number(season)).order('round'));

// ------------------------------------------------------------------------- profiles

export async function getNickname(userId) {
    const rows = await run(db.from('profiles').select('nickname').eq('user_id', userId));
    return rows?.[0]?.nickname ?? null;
}

export const saveNickname = (userId, nickname) =>
    run(db.from('profiles')
        .upsert({ user_id: userId, nickname, updated_at: new Date().toISOString() })
        .select('nickname').single());

// -------------------------------------------------------------------------- leagues

/** The leagues you run or have a team in. */
export const listLeagues = () =>
    run(db.from('leagues').select('id, name, season, created_at').order('created_at'));

export const createLeague = (name, season) =>
    run(db.from('leagues').insert({ name, season: Number(season) }).select('id, name, season, invite_code').single());

export const renameLeague = (id, name) =>
    run(db.from('leagues').update({ name }).eq('id', id).select('id, name').single());

export const deleteLeague = (id) => run(db.from('leagues').delete().eq('id', id));

/** Names and nicknames always; lineups only as saved at the lock of the latest round. */
export const leagueBoard = (id) => run(db.rpc('league_board', { lid: id }));

/** What an invite shows before joining, or null for a code that no longer works. */
export const leaguePreview = (code) => run(db.rpc('league_preview', { code }));

export const joinLeague = (code, teamId) => run(db.rpc('join_league', { code, team: teamId }));

export const resetInvite = (id) => run(db.rpc('reset_invite', { lid: id }));

/** Leaving (your own team) and removing (the admin, anyone's) are the same row going. */
export const removeFromLeague = (leagueId, teamId) =>
    run(db.from('league_teams').delete().eq('league_id', leagueId).eq('team_id', teamId));

export const leagueLink = (code) => `${window.location.origin}/?league=${encodeURIComponent(code)}`;

// An invite opened signed out survives the sign-in: Google sends you back to the bare
// origin (lib/auth.js), which would drop ?league=, so the code waits here meanwhile.
const PENDING_KEY = 'euroguru.pendingLeague';
const validCode = (code) => (code && /^[0-9a-f]{6,16}$/i.test(code) ? code : null);

/** The league invite this visit is about - from ?league=, or one awaiting sign-in - or null. */
export function readLeagueCode(search = window.location.search) {
    const fromUrl = validCode(new URLSearchParams(search).get('league'));
    try {
        if (fromUrl) window.sessionStorage.setItem(PENDING_KEY, fromUrl);
        return fromUrl ?? validCode(window.sessionStorage.getItem(PENDING_KEY));
    } catch {
        return fromUrl;
    }
}

/** Forget the invite - joined or dismissed - and drop ?league= from the address bar. */
export function clearLeagueCode() {
    try {
        window.sessionStorage.removeItem(PENDING_KEY);
    } catch { /* nothing was kept */ }
    const url = new URL(window.location.href);
    url.searchParams.delete('league');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
