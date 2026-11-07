// Run on https://x.com/EuroGuruFantasy/with_replies: every post @EuroGuruFantasy replied to
// (the post shown just above each of our replies) goes into the tab's sessionStorage, so
// rank.js never suggests answering it twice. Prints our latest replies as a check.
await (async () => {
  const answered = new Set(JSON.parse(sessionStorage.getItem('__answered') || '[]'));
  const mine = [];
  const statusOf = (a) => [...a.querySelectorAll('a[href*="/status/"]')].find((l) => l.querySelector('time'));
  const ours = (a) => (a?.querySelector('[data-testid="User-Name"]')?.innerText || '').toLowerCase().includes('@eurogurufantasy');
  const pass = () => {
    const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
    arts.forEach((a, i) => {
      if (!statusOf(a) || !ours(a)) return;
      const prev = arts[i - 1];
      if (prev && statusOf(prev) && !ours(prev)) answered.add(statusOf(prev).getAttribute('href').split('?')[0]);
      const t = a.querySelector('time')?.getAttribute('datetime')?.slice(5, 16);
      const x = (a.querySelector('[data-testid="tweetText"]')?.innerText || '').replace(/\s+/g, ' ').replace(/[=&?]/g, ' ').slice(0, 70);
      if (!mine.some((m) => m.startsWith(t))) mine.push(`${t} ${x}`);
    });
  };
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 5; i++) {
    pass();
    window.scrollBy(0, 1500);
    await new Promise((r) => setTimeout(r, 1500));
  }
  pass();
  sessionStorage.setItem('__answered', JSON.stringify([...answered]));
  return `answered ${answered.size}\n` + mine.slice(0, 12).join('\n');
})();
