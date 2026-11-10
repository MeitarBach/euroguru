// Hashtag discovery: the tags the collected fantasy posts use (scout.js's `fantasy` flag),
// most common first, with the ones already searched marked. Search every unmarked tag used
// by 3+ posts that is a fantasy tag (it names the game, a fantasy community or a fantasy
// campaign) - that's how new corners of the fantasy conversation turn up. Club and league
// tags don't count: their posts are about the games, not the fantasy game.
await (async () => {
  const posts = JSON.parse(sessionStorage.getItem('__scout') || '[]');
  const searched = new Set(posts.map((t) => t.source.toLowerCase()));
  const count = {};
  posts.filter((t) => t.fantasy).forEach((t) => (t.text.match(/#[\p{L}\p{N}_]+/gu) || [])
    .forEach((tag) => { tag = tag.toLowerCase(); count[tag] = (count[tag] || 0) + 1; }));
  return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([tag, n]) => `${tag} ${n}${[...searched].some((s) => s.includes(tag)) ? ' (searched)' : ''}`).join('\n');
})();
