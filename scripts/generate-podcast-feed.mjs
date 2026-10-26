import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const site = "https://politiekinperspectief.nl";
const directory = "assets/podcast";
const xml = (value = "") => String(value).replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character]);
const cdata = (value = "") => `<![CDATA[${String(value).replace(/]]>/g, "]] ]]> <![CDATA[>")}]]>`;
const clock = (seconds) => {
  const value = Math.round(Number(seconds));
  return `${String(Math.floor(value / 3600)).padStart(2, "0")}:${String(Math.floor((value % 3600) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

export async function generatePodcastFeed() {
  const root = process.cwd();
  const folder = path.join(root, directory);
  const names = await readdir(folder);
  const episodes = [];
  for (const name of names.filter((file) => /^politiek-in-perspectief-\d{4}-\d{2}-\d{2}\.json$/.test(file))) {
    const item = JSON.parse(await readFile(path.join(folder, name), "utf8"));
    if (item.status !== "klaar") continue;
    const base = name.slice(0, -5);
    episodes.push({ ...item, base, bytes: (await stat(path.join(folder, `${base}.mp3`))).size });
  }
  if (!episodes.length) throw new Error("Er is nog geen afgeronde podcastaflevering voor de feed.");
  episodes.sort((a, b) => b.publication_date.localeCompare(a.publication_date));
  const items = episodes.map((item) => `    <item>\n      <title>${xml(item.title)}</title>\n      <guid isPermaLink="false">politiek-in-perspectief-${item.publication_date}</guid>\n      <pubDate>${new Date(`${item.publication_date}T06:00:00Z`).toUTCString()}</pubDate>\n      <description>${cdata(`Een rustige, journalistieke terugblik op de Nederlandse en Europese politiek van ${item.period}.`)}</description>\n      <enclosure url="${site}/${directory}/${item.base}.mp3" length="${item.bytes}" type="audio/mpeg" />\n      <itunes:duration>${clock(item.duration_seconds)}</itunes:duration>\n      <itunes:episodeType>full</itunes:episodeType>\n      <explicit>false</explicit>\n    </item>`).join("\n");
  const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">\n  <channel>\n    <title>Politiek in Perspectief</title>\n    <link>${site}/</link>\n    <language>nl-NL</language>\n    <copyright>© Politiek in Perspectief</copyright>\n    <description>${cdata("Wekelijkse, rustige duiding bij Nederlandse en Europese politiek.")}</description>\n    <itunes:title>Politiek in Perspectief</itunes:title>\n    <itunes:subtitle>Wekelijkse politieke duiding</itunes:subtitle>\n    <itunes:summary>${cdata("Wekelijkse, rustige duiding bij Nederlandse en Europese politiek.")}</itunes:summary>\n    <itunes:author>Politiek in Perspectief</itunes:author>\n    <itunes:explicit>false</itunes:explicit>\n    <itunes:type>episodic</itunes:type>\n    <itunes:category text="News"><itunes:category text="Politics" /></itunes:category>\n    <itunes:image href="${site}/${directory}/cover-1400.jpg" />\n${items}\n  </channel>\n</rss>\n`;
  await writeFile(path.join(root, "podcast.xml"), feed);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await generatePodcastFeed();
