import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export function validateScript(script) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(script.publication_date) || !script.title || !script.disclosure || !script.sections?.length) {
    throw new Error("Het podcastscript mist verplichte onderdelen.");
  }
  if (script.sections.length > 16) throw new Error("Te veel fragmenten voor deze proefaflevering.");
  for (const section of script.sections) {
    if (!section.title || typeof section.text !== "string" || !section.text.trim() || section.text.length > 4096) {
      throw new Error("Een podcastfragment is leeg of langer dan 4096 tekens.");
    }
  }
  const words = script.sections.map((section) => section.text).join(" ").trim().split(/\s+/).length;
  if (words < 900 || words > 1300) throw new Error("Een proef van 7–8 minuten vraagt ongeveer 900–1300 woorden.");
  return words;
}

export function chooseTempo(duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Ongeldige audiolengte.");
  // Kleine tempoaanpassing wanneer de natuurlijke voordracht buiten 7–8 minuten valt.
  if (duration >= 420 && duration <= 480) return 1;
  return Math.max(0.88, Math.min(1.12, duration / 450));
}

const durationOf = (file) => Number(execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file
], { encoding: "utf8" }).trim());
const clock = (seconds) => {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
};

export async function generatePodcastTrial() {
  const root = process.cwd();
  const date = process.env.EDITION_DATE || "2026-10-26";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Gebruik YYYY-MM-DD als publicatiedatum.");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY ontbreekt; gebruik de bestaande GitHub Secret.");
  const script = JSON.parse(await readFile(path.join(root, "podcast", "scripts", `${date}.json`), "utf8"));
  if (script.publication_date !== date) throw new Error("De datum van het podcastscript komt niet overeen.");
  const words = validateScript(script);
  const edition = await readFile(path.join(root, script.source_edition));
  const sourceSha = createHash("sha1").update(`blob ${edition.length}\0`).update(edition).digest("hex");
  if (sourceSha !== script.source_blob_sha) throw new Error("De broneditie is gewijzigd; controleer eerst het podcastscript.");
  const model = process.env.PODCAST_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = "marin";
  const work = await mkdtemp(path.join(tmpdir(), "pip-podcast-"));
  const output = path.join(root, "assets", "podcast");
  await mkdir(output, { recursive: true });
  const parts = [];
  const instructions = "Spreek rustig, helder en warm Nederlands, met dezelfde neutrale journalistieke vertelstem in alle fragmenten. Houd een natuurlijk tempo van ongeveer 145 tot 150 woorden per minuut. Gebruik korte natuurlijke adempauzes tussen zinnen en alinea's. Geen opgewekte reclamesfeer, geen theatrale nadruk en geen muziek of geluidseffecten. Spreek bedragen en jaartallen natuurlijk uit. Spreek PHP als pee haa pee, AVG als aa vee gee, EU als ee uu en EU Inc. als ee uu ink. Lees uitsluitend de aangeleverde tekst; voeg geen introductie of afsluiting toe.";

  for (const [index, section] of script.sections.entries()) {
    console.log(`Maak fragment ${index + 1}/${script.sections.length}: ${section.title}`);
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, voice, response_format: "wav", speed: 0.98, input: section.text, instructions }),
      signal: AbortSignal.timeout(180_000)
    });
    if (!response.ok) throw new Error(`Spraakgeneratie mislukt bij fragment ${index + 1}: HTTP ${response.status}.`);
    const raw = path.join(work, `fragment-${index}.wav`);
    await writeFile(raw, Buffer.from(await response.arrayBuffer()));
    const padded = path.join(work, `fragment-${index}-pauze.wav`);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af", "apad=pad_dur=0.35", "-ar", "24000", "-ac", "1", padded]);
    parts.push({ title: section.title, file: padded, duration: durationOf(padded) });
  }
  const list = path.join(work, "fragmenten.txt");
  await writeFile(list, parts.map((part) => `file '${part.file}'`).join("\n"));
  const joined = path.join(work, "volledige-proef.wav");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", joined]);
  const rawDuration = durationOf(joined);
  const tempo = chooseTempo(rawDuration);
  const base = `assets/podcast/concept-${date}`;
  const mp3 = `${base}.mp3`;
  const transcript = `${base}.md`;
  const metadata = `${base}.json`;
  const filters = [...(tempo === 1 ? [] : [`atempo=${tempo.toFixed(6)}`]), "loudnorm=I=-19:TP=-1.5:LRA=7"].join(",");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", joined, "-af", filters,
    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k",
    "-metadata", `title=${script.title}`, "-metadata", "artist=Politiek in Perspectief",
    "-metadata", "album=Proefafleveringen", "-metadata", `date=${date}`,
    "-metadata", "comment=Concept; ingesproken met een AI-stem", path.join(root, mp3)
  ]);
  const duration = durationOf(path.join(root, mp3));
  if (!Number.isFinite(duration) || duration < 120) throw new Error("De audiolengte klopt niet met een volledige aflevering.");
  let elapsed = 0;
  const chapters = parts.map((part) => {
    const chapter = { title: part.title, start_seconds: Math.round(elapsed / tempo * 100) / 100 };
    elapsed += part.duration;
    return chapter;
  });
  const info = {
    title: script.title, status: "concept", publication_date: date, period: script.period,
    ai_voice: true, disclosure: script.disclosure, voice, model,
    duration_seconds: duration, raw_duration_seconds: rawDuration, tempo_adjustment: tempo,
    word_count: words, source_edition: script.source_edition, source_blob_sha: script.source_blob_sha,
    generated_at: new Date().toISOString(), chapters, sources: script.sources
  };
  await writeFile(path.join(root, metadata), `${JSON.stringify(info, null, 2)}\n`);
  await writeFile(path.join(root, transcript), `# ${script.title}\n\nConcept om te beluisteren en beoordelen. Verslagperiode: ${script.period}. Duur: ${clock(duration)}.\n\n${script.disclosure}\n\n${script.sections.map((section) => `## ${section.title}\n\n${section.text}`).join("\n\n")}\n\n## Bronnen\n\n${script.sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `mp3=${mp3}\ntranscript=${transcript}\nmetadata=${metadata}\nduration=${clock(duration)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Volledige podcastproef\n\n${script.title}\n\n- Duur: ${clock(duration)}\n- Woorden: ${words}\n- Stem: ${voice} (AI)\n- Geen publicatie op de website of Apple Podcasts.\n`);
  }
  const repository = process.env.GITHUB_REPOSITORY || "FkoNL/politiek-in-perspectief";
  const branch = `podcast-proef-${process.env.GITHUB_RUN_ID || "lokaal"}`;
  await writeFile(path.join(process.env.RUNNER_TEMP || work, "podcast-proef-pr.md"), `Volledige conceptaflevering op basis van de editie van ${date}, met de gekozen AI-stem Marin.\n\nDuur: **${clock(duration)}**.\n\n[Beluister of download de MP3](https://raw.githubusercontent.com/${repository}/${branch}/${mp3}) · [Lees het script](https://github.com/${repository}/blob/${branch}/${transcript})\n\n${script.disclosure}\n\nDeze proef staat klaar voor beoordeling. Zij is nog niet gekoppeld aan de website, de automatische maandagworkflow of Apple Podcasts.\n`);
  console.log(`Podcastproef klaar: ${mp3} (${clock(duration)}).`);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generatePodcastTrial();
}
