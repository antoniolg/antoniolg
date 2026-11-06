// Regenerates the dynamic sections of a GitHub profile README.
// Each section lives between <!-- name:start --> and <!-- name:end -->.
// A section whose source fails keeps its previous content, so a flaky feed never empties the profile.
// Usage: node update-readme.mjs <personal|devexpert> <README path>
import fs from 'node:fs/promises';

const [profile, readmePath] = process.argv.slice(2);
const CHANNEL_ID = 'UCV31octs5hft6bZmokUgQlA';
const UA = { 'User-Agent': 'Mozilla/5.0 (profile-readme-updater)', 'Accept-Language': 'en-US', Cookie: 'SOCS=CAI; CONSENT=YES+' };
const GH = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

const text = async (url, headers = UA) => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};
const json = async (url) => JSON.parse(await text(url, GH));
const decode = (s) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const md = (s) => s.replace(/([\[\]|])/g, '\\$1');

async function rss(url, count) {
  const xml = await text(url);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, count).map(([, item]) => ({
    title: decode(item.match(/<title>([\s\S]*?)<\/title>/)[1]),
    link: decode(item.match(/<link>([\s\S]*?)<\/link>/)[1]),
  }));
  if (!items.length) throw new Error(`${url}: no items`);
  return items.map((i) => `- [${md(i.title)}](${i.link})`).join('\n');
}

async function videos(count, heading) {
  const xml = await text(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  const list = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, count).map(([, e]) => ({
    id: e.match(/<yt:videoId>(.*?)</)[1],
    title: decode(e.match(/<title>([\s\S]*?)<\/title>/)[1]),
  }));
  if (list.length < 2) throw new Error('youtube: too few videos');
  const cell = (v) =>
    `<td width="50%" valign="top"><a href="https://www.youtube.com/watch?v=${v.id}"><img src="https://i.ytimg.com/vi/${v.id}/mqdefault.jpg" alt="${v.title.replace(/"/g, '&quot;')}" width="100%"></a><br><sub>${v.title.replace(/</g, '&lt;')}</sub></td>`;
  const rows = [];
  for (let i = 0; i < list.length; i += 2) rows.push(`<tr>${list.slice(i, i + 2).map(cell).join('')}</tr>`);
  return `${heading}\n\n<table>\n${rows.join('\n')}\n</table>`;
}

async function subscribersBadge() {
  const html = await text('https://www.youtube.com/@devexpert_io');
  const m = html.match(/"content":"([0-9.,]+[KkM]?) subscribers"/);
  if (!m) throw new Error('youtube: subscriber count not found');
  return `[![YouTube](https://img.shields.io/badge/YouTube-${encodeURIComponent(m[1])}_subscribers-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://www.youtube.com/@devexpert_io)`;
}

async function latestActivity() {
  // Events no longer carry commits, so look at the default branch of the most recently pushed public repos.
  const repos = (await json('https://api.github.com/users/antoniolg/repos?sort=pushed&per_page=15&type=owner'))
    .filter((r) => !r.fork && !r.archived && !['antoniolg', 'homebrew-tap'].includes(r.name));
  let best;
  for (const r of repos.slice(0, 8)) {
    const commits = await json(`https://api.github.com/repos/${r.full_name}/commits?per_page=10`).catch(() => []);
    const c = commits.find((c) => !/dependabot|github-actions/i.test(`${c.commit.author?.name} ${c.author?.login ?? ''}`));
    if (c && (!best || c.commit.committer.date > best.date)) best = { repo: r.name, date: c.commit.committer.date, message: c.commit.message.split('\n')[0] };
  }
  if (!best) throw new Error('github: no recent commit');
  return `🛠️ Last commit (${best.date.slice(0, 10)}) in **[${best.repo}](https://github.com/antoniolg/${best.repo})**: \`${best.message.replace(/`/g, "'")}\``;
}

async function releases(repos) {
  const rows = [];
  for (const repo of repos) {
    try {
      const r = await json(`https://api.github.com/repos/${repo}/releases/latest`);
      rows.push({ repo, tag: r.tag_name, date: r.published_at.slice(0, 10), url: r.html_url });
    } catch {
      /* repo without releases */
    }
  }
  if (!rows.length) throw new Error('github: no releases');
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return ['| Tool | Latest release | Date |', '| --- | --- | --- |', ...rows.map((r) => `| [${r.repo.split('/')[1]}](https://github.com/${r.repo}) | [${r.tag}](${r.url}) | ${r.date} |`)].join('\n');
}

async function edition() {
  const html = await text('https://devexpert.io/');
  const plain = decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const m = plain.match(/empieza el (\d{1,2} de [a-záéíóú]+)\s*·\s*(\d+) plazas/i);
  if (!m) throw new Error('devexpert: edition not found');
  return `🗓️ **La próxima edición de AI Expert empieza el ${m[1]}**, con ${m[2]} plazas. [Ver el programa y reservar →](https://devexpert.io/cursos/expert/ai)`;
}

async function hitl() {
  const html = await text('https://hitl.day/');
  const plain = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n'))
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const i = plain.findIndex((l) => /^(lunes|martes|miércoles|jueves|viernes|sábado|domingo) \d{1,2} [a-z]{3}/i.test(l));
  if (i < 0) throw new Error('hitl: no date');
  const when = plain[i];
  // After the date the page lists «dónde», the place lines and then «formato».
  const after = plain.slice(i + 1, i + 8);
  const end = after.findIndex((l) => /^formato$/i.test(l));
  const where = after.slice(0, end < 0 ? 3 : end).filter((l) => !/^dónde$/i.test(l)).join(' ').replace(/\s*·\s*/g, ', ').replace(/[,\s]+$/, '');
  const luma = html.match(/https:\/\/(?:lu\.ma|luma\.com)\/[A-Za-z0-9_-]+/)?.[0] ?? 'https://hitl.day';
  return `🧑‍🤝‍🧑 **Próximo Humans in the Loop: ${when}** (${where}). En persona y gratis. [Apúntate en Luma →](${luma})`;
}

const SECTIONS = {
  personal: {
    'youtube-subs': subscribersBadge,
    now: latestActivity,
    posts: () => rss('https://antonioleiva.com/en/rss.xml', 4),
    videos: () => videos(4, 'In Spanish, on the [DevExpert channel](https://www.youtube.com/@devexpert_io):'),
    releases: () => releases(['antoniolg/postflow', 'antoniolg/remote-sessions', 'antoniolg/next-dj', 'antoniolg/listmonk-cli', 'antoniolg/justdoit', 'antoniolg/aipal']),
  },
  devexpert: {
    'youtube-subs': subscribersBadge,
    edition,
    hitl,
    posts: () => rss('https://devexpert.io/blog/rss.xml', 5),
    videos: () => videos(4, 'Lo último en el [canal de YouTube](https://www.youtube.com/@devexpert_io):'),
  },
}[profile];
if (!SECTIONS) throw new Error(`unknown profile: ${profile}`);

let readme = await fs.readFile(readmePath, 'utf8');
let failures = 0;
for (const [name, build] of Object.entries(SECTIONS)) {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(readme)) continue;
  try {
    const content = await build();
    readme = readme.replace(re, (_, a, b) => `${a}\n${content}\n${b}`);
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.warn(`kept ${name}: ${err.message}`);
  }
}
await fs.writeFile(readmePath, readme);
if (failures === Object.keys(SECTIONS).length) process.exit(1);
