// Collects the posts on the X page open in the tab (a search, a profile, a timeline) into
// window.__scout, keyed by status path so several searches add up without duplicates.
// Navigating reloads the page, so the posts are also kept in the tab's sessionStorage and
// read back on the next page. Scrolls ROUNDS screens. Run with the Chrome extension's
// javascript_tool; returns the count. Text is stored with = & ? replaced: the extension
// blocks output that looks like cookies or query strings, and those three trigger it.
// Each post is flagged `fantasy` when it is about the fantasy game itself, not EuroLeague
// or basketball in general: it names the game (fantasy, Dunkest, the Hebrew פנטזי, #EBF
// next to EuroLeague - alone it also tags Egypt's basketball federation and more)
// or speaks its language (FPT, a price in CR, captain picks, wildcard - τζόκερ in Greek -,
// unlimited trades, price rises, must-haves). rank.js keeps only those.
await (async () => {
  const ROUNDS = 10;
  const FANTASY = /(?<!battle)fantasy|dunkest|\bebf\b(?=[\s\S]*euroleague)|euroleague[\s\S]*\bebf\b|פנטזי|פנטסי|דאנקסט|\bfpts?\b|\b\d{1,3}([.,]\d)? ?(cr|credits)\b|wild ?card|τζόκερ|τζοκερ|captain(cy|ed)\b|\b(who|whom) (to|should (i|we|you)) captain|captain (pick|choice|option)|my captain|rate my (team|lineup|squad)|(unlimited|free) (trades|changes|transfers|exchanges)|price (rise|drop|change|increase|decrease)|must[- ]have/iu;
  window.__scout = new Map(JSON.parse(sessionStorage.getItem('__scout') || '[]').map((t) => [t.path, t]));
  const num = (s) => {
    const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KM]?)/i);
    return m ? Math.round(parseFloat(m[1]) * ({ K: 1e3, M: 1e6 }[m[2].toUpperCase()] || 1)) : 0;
  };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[=&?]/g, ' ').trim();
  const source = clean(new URLSearchParams(location.search).get('q') || location.pathname);
  const grab = () => {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      const link = [...a.querySelectorAll('a[href*="/status/"]')].find((l) => l.querySelector('time'));
      if (!link) return;
      const path = link.getAttribute('href').split('?')[0];
      if (window.__scout.has(path)) return;
      const who = (a.querySelector('[data-testid="User-Name"]')?.innerText || '').split('\n');
      const raw = a.querySelector('[data-testid="tweetText"]')?.innerText || '';
      const stat = (k) => num(a.querySelector(`[data-testid="${k}"], [data-testid="un${k}"]`)?.innerText);
      window.__scout.set(path, {
        path,
        handle: (who.find((p) => p.startsWith('@')) || '').slice(1),
        name: clean(who[0]).slice(0, 30),
        time: a.querySelector('time')?.getAttribute('datetime') || '',
        replies: stat('reply'), reposts: stat('retweet'), likes: stat('like'),
        views: num(a.querySelector('a[href$="/analytics"]')?.innerText),
        media: !!a.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]'),
        question: raw.includes('?'),
        fantasy: FANTASY.test(raw),
        lang: a.querySelector('[data-testid="tweetText"]')?.getAttribute('lang') || '',
        text: clean(raw).slice(0, 320),
        source,
      });
    });
  };
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < ROUNDS; i++) {
    grab();
    window.scrollBy(0, 1500);
    await new Promise((r) => setTimeout(r, 1500));
  }
  grab();
  sessionStorage.setItem('__scout', JSON.stringify([...window.__scout.values()]));
  return window.__scout.size;
})();
