// Ranks the fantasy posts scout.js collected (the tab's sessionStorage) and prints the first
// page. A post counts when scout.js flagged it `fantasy`, or when its author is a fantasy
// account: the handle or name says so, or 2+ of their collected posts are flagged. Posts
// kept only for their author show ACCT - read those before picking one.
// Then print the next ones with  window.__page(1)  window.__page(2) ...  (4 posts a page -
// output past ~1,000 characters gets cut). Value = reach (views, likes, reposts) per hour of
// age, x1.5 for a question (people want answers), x0.6 once a post has 60+ replies (a new
// reply sinks). Each author's 3rd and later posts sink to the bottom, so a scan isn't one
// busy account. Dropped: our own posts, posts we already answered (answered.js) or already
// suggested (sessionStorage '__skip', a JSON list of paths), anything older than MAX_HOURS,
// posts without text and posts not about fantasy (counted in the header).
// window.__paths(['<last digits>', ...]) prints full status paths.
await (async () => {
  const MAX_HOURS = 48;
  const PER_AUTHOR = 2;
  const OURS = 'eurogurufantasy';
  const answered = new Set(JSON.parse(sessionStorage.getItem('__answered') || '[]'));
  const skip = new Set(JSON.parse(sessionStorage.getItem('__skip') || '[]'));
  const seen = {};
  const all = JSON.parse(sessionStorage.getItem('__scout') || '[]');
  const flagged = {};
  all.forEach((t) => { if (t.fantasy) flagged[t.handle] = (flagged[t.handle] || 0) + 1; });
  const fantasyAccount = (t) => /fantasy|dunkest|ebf/i.test(`${t.handle} ${t.name}`) || flagged[t.handle] >= 2;
  const fresh = all
    .map((t) => ({ ...t, age: (Date.now() - Date.parse(t.time)) / 36e5 }))
    .filter((t) => t.text && t.age < MAX_HOURS && t.handle.toLowerCase() !== OURS
      && !answered.has(t.path) && !skip.has(t.path));
  const rows = fresh
    .filter((t) => t.fantasy || fantasyAccount(t))
    .map((t) => ({
      ...t,
      value: Math.round(((t.views + 30 * t.likes + 60 * t.reposts) / (t.age + 2))
        * (t.question ? 1.5 : 1) * (t.replies >= 60 ? 0.6 : 1)),
    }))
    .sort((a, b) => b.value - a.value)
    .map((t) => ({ ...t, extra: (seen[t.handle] = (seen[t.handle] || 0) + 1) > PER_AUTHOR }))
    .sort((a, b) => a.extra - b.extra || b.value - a.value);
  window.__ranked = rows;
  const id = (t) => t.path.split('/status/')[1].slice(-6);
  window.__fmt = (t, i) => `${i + 1}. [${t.value}] @${t.handle} ${t.age.toFixed(1)}h ${t.lang} r${t.replies} `
    + `l${t.likes} v${t.views}${t.media ? ' IMG' : ''}${t.question ? ' Q' : ''}${t.fantasy ? '' : ' ACCT'} ${id(t)}\n   ${t.text.slice(0, 150)}`;
  window.__page = (n) => rows.slice(n * 4, n * 4 + 4).map((t, i) => window.__fmt(t, n * 4 + i)).join('\n');
  window.__full = (ids) => rows.filter((t) => ids.includes(id(t))).map((t) => `${id(t)} @${t.handle}: ${t.text}`).join('\n');
  window.__paths = (ids) => rows.filter((t) => ids.includes(id(t))).map((t) => t.path).join('\n');
  return `${rows.length} fantasy posts in the last ${MAX_HOURS}h (${fresh.length - rows.length} not about fantasy, `
    + `${answered.size} answered, ${skip.size} skipped)\n` + window.__page(0);
})();
