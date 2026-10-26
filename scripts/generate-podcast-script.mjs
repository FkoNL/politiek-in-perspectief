import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { narration, validateScript } from "./generate-podcast-trial.mjs";

const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos|#039|#39|#x27|nbsp);/g, (_, entity) => ({
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#039": "'", "#39": "'", "#x27": "'", nbsp: " "
})[entity]);
const plain = (html = "") => decode(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
const blobSha = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const dutchDate = (date) => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);

export function publicationPeriod(value) {
  const date = value || new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date());
  const publication = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(publication.getTime()) || publication.toISOString().slice(0, 10) !== date) {
    throw new Error("Gebruik een geldige publicatiedatum in YYYY-MM-DD.");
  }
  const end = new Date(publication);
  end.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7 - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { date, publication, start, end, edition: `edities/${end.toISOString().slice(0, 10)}.html` };
}

export function extractEdition(html) {
  const sources = new Map();
  const stories = [...html.matchAll(/<article class="news-item"[^>]*>[\s\S]*?<\/article>/g)].map(([article]) => {
    const links = [...article.matchAll(/<a href="(https:\/\/[^"\s]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((match) => ({ url: decode(match[1]), title: plain(match[2]) }));
    for (const source of links) sources.set(source.url, source);
    return { headline: plain(article.match(/<h3>([\s\S]*?)<\/h3>/)?.[1]), text: plain(article.replace(/<p class="article-sources">[\s\S]*?<\/p>/g, "")), sources: links };
  });
  if (!stories.length || stories.some((story) => !story.headline || !story.sources.length)) {
    throw new Error("De weekeditie bevat geen bruikbare berichten met bronverwijzingen.");
  }
  return {
    summary: plain(html.match(/<div class="brief-copy">([\s\S]*?)<\/div>/)?.[1]),
    stories,
    outlook: plain(html.match(/<section class="outlook shell"[^>]*>([\s\S]*?)<\/section>/)?.[1]),
    sources: [...sources.values()]
  };
}

export function reusableEpisode(metadata, sourceSha) {
  return metadata?.source_blob_sha === sourceSha && metadata.ai_voice === true &&
    metadata.voice === narration.voice && metadata.narration_speed === narration.speed &&
    metadata.narration_instructions === narration.instructions && metadata.tempo_adjustment === 1;
}

function githubJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

export async function preparePodcast() {
  const period = publicationPeriod(process.env.REQUESTED_DATE || process.env.EDITION_DATE);
  const bytes = await readFile(period.edition);
  const sourceSha = blobSha(bytes);
  const base = `assets/podcast/politiek-in-perspectief-${period.date}`;
  const automaticBranch = `podcast-weekeditie-${period.date}-${sourceSha.slice(0, 12)}`;
  const regenerate = process.env.REGENERATE === "true";
  const branch = regenerate ? `podcast-aflevering-${process.env.GITHUB_RUN_ID}` : automaticBranch;
  const repository = process.env.GITHUB_REPOSITORY || "FkoNL/politiek-in-perspectief";
  let existing = "";
  if (!regenerate) {
    try {
      const metadata = JSON.parse(await readFile(`${base}.json`, "utf8"));
      await access(`${base}.mp3`);
      if (reusableEpisode(metadata, sourceSha)) existing = `https://raw.githubusercontent.com/${repository}/${process.env.SOURCE_REF || "main"}/${base}.mp3`;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!existing && process.env.GH_TOKEN) {
      const prs = githubJson(["pr", "list", "--base", "main", "--state", "open", "--limit", "100", "--json", "headRefName,title"]);
      const candidates = [...new Set([automaticBranch, ...prs.filter((pr) => /podcastaflevering/i.test(pr.title) && pr.title.includes(period.date)).map((pr) => pr.headRefName)])];
      for (const head of candidates) {
        let response;
        try {
          response = githubJson(["api", `repos/${repository}/contents/${base}.json?ref=${encodeURIComponent(head)}`]);
        } catch (error) {
          if (String(error.stderr).includes("404")) continue;
          throw error;
        }
        const metadata = JSON.parse(Buffer.from(response.content, "base64").toString("utf8"));
        if (reusableEpisode(metadata, sourceSha)) {
          existing = `https://raw.githubusercontent.com/${repository}/${head}/${base}.mp3`;
          break;
        }
      }
    }
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `date=${period.date}\nsource_sha=${sourceSha}\nbranch=${branch}\nexists=${Boolean(existing)}\n`);
  if (existing && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Podcast bestaat al; geen nieuwe tekst- of spraakgeneratie. [Beluister de aflevering](${existing}).\n`);
  return { ...period, sourceSha, existing, branch };
}

export async function generatePodcastScript() {
  const period = publicationPeriod(process.env.EDITION_DATE);
  const root = process.cwd();
  const bytes = await readFile(path.join(root, period.edition));
  const sourceSha = blobSha(bytes);
  const scriptFile = path.join(root, "podcast", "scripts", `${period.date}.json`);
  const prompt = await readFile(path.join(root, "prompts", "podcast.md"), "utf8");
  const promptSha = createHash("sha256").update(prompt).digest("hex");
  const cacheFile = path.join(root, ".podcast-cache", "scripts", `${period.date}-${sourceSha}-${promptSha}.json`);
  for (const file of [scriptFile, cacheFile]) {
    try {
      const script = JSON.parse(await readFile(file, "utf8"));
      if (script.source_blob_sha !== sourceSha || script.publication_date !== period.date) continue;
      validateScript(script);
      await mkdir(path.dirname(scriptFile), { recursive: true });
      await writeFile(scriptFile, `${JSON.stringify(script, null, 2)}\n`);
      console.log(`Gebruik voorbereid luisterscript voor ${period.date}.`);
      return script;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY ontbreekt; gebruik de GitHub Secret.");
  const edition = extractEdition(bytes.toString("utf8"));
  const schema = {
    type: "object", additionalProperties: false, required: ["intro", "sections", "outlook"],
    properties: {
      intro: { type: "string" }, outlook: { type: "string" },
      sections: { type: "array", minItems: 1, maxItems: 10, items: {
        type: "object", additionalProperties: false, required: ["title", "text"],
        properties: { title: { type: "string" }, text: { type: "string" } }
      } }
    }
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-6-luna", reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "podcast_script", strict: true, schema } },
      input: [
        { role: "developer", content: prompt },
        { role: "user", content: JSON.stringify({ publication_date: period.date, period: `${dutchDate(period.start)}–${dutchDate(period.end)}`, ...edition }) }
      ]
    }), signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) throw new Error(`Luisterscript genereren mislukt: HTTP ${response.status}.`);
  const result = await response.json();
  const text = (result.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text).join("");
  const generated = JSON.parse(text);
  const disclosure = "Deze aflevering is ingesproken met een AI-stem, op basis van menselijke instructies.";
  const script = {
    title: `Politiek in Perspectief — ${dutchDate(period.publication)}`,
    publication_date: period.date, period: `${dutchDate(period.start)}–${dutchDate(period.end)}`,
    source_edition: period.edition, source_blob_sha: sourceSha, script_prompt_sha: promptSha, disclosure,
    sections: [
      { title: "Opening", text: `Welkom bij Politiek in Perspectief. Dit is de editie van ${dutchDate(period.publication)}, met een terugblik op ${dutchDate(period.start)} tot en met ${dutchDate(period.end)}. Deze aflevering is ingesproken met een AI-stem. ${generated.intro}` },
      ...generated.sections,
      { title: "Vooruitblik en afsluiting", text: `${generated.outlook} Dit was Politiek in Perspectief. De volledige editie en de aanklikbare bronnen vind je op politiek in perspectief punt en el. Dank voor het luisteren.` }
    ], sources: edition.sources
  };
  validateScript(script);
  if (/\b(proefaflevering|podcastproef|demo)\b/i.test(script.sections.map((section) => section.text).join(" "))) throw new Error("Het script bevat proeftekst; er wordt geen audio gemaakt.");
  await mkdir(path.dirname(scriptFile), { recursive: true });
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, `${JSON.stringify(script, null, 2)}\n`);
  await writeFile(scriptFile, `${JSON.stringify(script, null, 2)}\n`);
  console.log(`Luisterscript voor ${period.date} aangemaakt op basis van ${period.edition}.`);
  return script;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--prepare")) await preparePodcast();
  else await generatePodcastScript();
}
