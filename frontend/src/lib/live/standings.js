/**
 * Watch Room standings for the Live hub: a room's board as scoreable groups, and where
 * each of your teams stands in it.
 */

/**
 * room_board's teams in the shape the Live tab scores (a group per team): lineups as
 * saved at the round's lock, empty before it - the database does not reveal them earlier.
 */
export function boardTeams(board) {
    return (board?.teams ?? []).map((t, i) => ({
        id: t.team_id,
        name: `${t.name} · ${t.nickname}`,
        teamName: t.name,
        nickname: t.nickname,
        mine: t.mine,
        color: i,
        lineupSaved: Boolean(t.lineup),
        keys: t.lineup?.keys ?? [],
        bench: t.lineup?.bench ?? [],
        captain: t.lineup?.captain ?? null,
        coach: t.lineup?.coach ?? null,
    }));
}

/** Scored groups in board order: most points, then the best projection, then by name. */
export const rankGroups = (groups) => [...groups].sort((a, b) =>
    (b.sums.total - a.sums.total) || (b.sums.projected - a.sums.projected) || a.name.localeCompare(b.name));

/**
 * One room's standing from its scored groups: the ranking, the leader, your best team
 * (with its place) and every team of yours by id. `revealed` is false before the lock,
 * when nobody's lineup is known and a ranking would mean nothing.
 */
export function standingOf(groups) {
    const ranked = rankGroups(groups);
    const places = new Map(ranked.map((g, i) => [g.id, i + 1]));
    const mine = ranked.filter(g => g.mine);
    return {
        ranked,
        leader: ranked[0] ?? null,
        best: mine[0] ? { team: mine[0], place: places.get(mine[0].id) } : null,
        placeOf: (teamId) => places.get(teamId) ?? null,
        size: ranked.length,
        revealed: groups.some(g => g.lineupSaved),
    };
}
