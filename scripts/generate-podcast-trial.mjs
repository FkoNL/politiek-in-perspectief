import { access, appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export function validateScript(script) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(script.publication_date) || !script.title || !script.disclosure || !script.sections?.length) {
    throw new Error("Het podcastscript mist verplichte onderdelen.");
  }
  if (script.sections.length > 16) throw new Error("Te veel fragmenten voor deze aflevering.");
  for (const section of script.sections) {
    if (!section.title || typeof section.text !== "string" || !section.text.trim() || section.text.length > 4096) {
      throw new Error("Een podcastfragment is leeg of langer dan 4096 tekens.");
    }
  }
  const words = script.sections.map((section) => section.text).join(" ").trim().split(/\s+/).length;
  if (words < 700 || words > 1400) throw new Error("De voorbereide aflevering moet ongeveer 700–1400 woorden bevatten.");
  return words;
}

// Dezelfde stemaansturing als de goedgekeurde minuutproef, zonder versnelling achteraf.
export const narration = Object.freeze({
  voice: "marin",
  speed: 1,
  instructions: "Spreek rustig, helder en warm Nederlands. Houd het tempo bedachtzaam en journalistiek, zonder opgewekte reclamesfeer."
});

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
  const { voice, speed, instructions } = narration;
  const work = await mkdtemp(path.join(tmpdir(), "pip-podcast-"));
  const output = path.join(root, "assets", "podcast");
  await mkdir(output, { recursive: true });
  const parts = [];
  const signature = createHash("sha256").update(JSON.stringify({ script, model, voice, instructions, speed })).digest("hex");
  const cache = path.join(root, ".podcast-cache", signature);
  await mkdir(cache, { recursive: true });

  for (const [index, section] of script.sections.entries()) {
    console.log(`Maak fragment ${index + 1}/${script.sections.length}: ${section.title}`);
    const raw = path.join(cache, `fragment-${index}.wav`);
    let cached = false;
    try { await access(raw); cached = process.env.REGENERATE_AUDIO !== "true" && durationOf(raw) > 0; } catch (error) {
      if (error.code !== "ENOENT" && !error.status) throw error;
    }
    if (cached) {
      console.log(`Gebruik bewaard fragment ${index + 1}.`);
    } else {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, voice, response_format: "wav", speed, input: section.text, instructions }),
            signal: AbortSignal.timeout(90_000)
          });
          if (!response.ok) {
            const error = new Error(`Spraakgeneratie mislukt bij fragment ${index + 1}: HTTP ${response.status}.`);
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
          }
          const audio = Buffer.from(await response.arrayBuffer());
          if (audio.length < 44) throw new Error("De spraak-API gaf geen bruikbaar audiobestand terug.");
          await writeFile(raw, audio);
          break;
        } catch (error) {
          if (attempt === 2 || !(error.retryable || ["TimeoutError", "AbortError", "TypeError"].includes(error.name))) throw error;
          console.log(`Tijdelijke onderbreking bij fragment ${index + 1}; poging ${attempt + 2}/3.`);
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
        }
      }
    }
    const padded = path.join(work, `fragment-${index}-pauze.wav`);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af", "apad=pad_dur=0.35", "-ar", "24000", "-ac", "1", padded]);
    parts.push({ title: section.title, file: padded, duration: durationOf(padded) });
  }
  const list = path.join(work, "fragmenten.txt");
  await writeFile(list, parts.map((part) => `file '${part.file}'`).join("\n"));
  const joined = path.join(work, "volledige-aflevering.wav");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", joined]);
  const rawDuration = durationOf(joined);
  const base = `assets/podcast/politiek-in-perspectief-${date}`;
  const mp3 = `${base}.mp3`;
  const transcript = `${base}.md`;
  const metadata = `${base}.json`;
  const filters = "loudnorm=I=-19:TP=-1.5:LRA=7";
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", joined, "-af", filters,
    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k",
    "-metadata", `title=${script.title}`, "-metadata", "artist=Politiek in Perspectief",
    "-metadata", "album=Politiek in Perspectief", "-metadata", `date=${date}`,
    "-metadata", "comment=Ingesproken met een AI-stem", path.join(root, mp3)
  ]);
  const duration = durationOf(path.join(root, mp3));
  if (!Number.isFinite(duration) || duration < 120) throw new Error("De audiolengte klopt niet met een volledige aflevering.");
  let elapsed = 0;
  const chapters = parts.map((part) => {
    const chapter = { title: part.title, start_seconds: Math.round(elapsed * 100) / 100 };
    elapsed += part.duration;
    return chapter;
  });
  const info = {
    title: script.title, status: "klaar", publication_date: date, period: script.period,
    ai_voice: true, disclosure: script.disclosure, voice, model,
    duration_seconds: duration, raw_duration_seconds: rawDuration, tempo_adjustment: 1,
    narration_speed: speed, narration_instructions: instructions,
    word_count: words, source_edition: script.source_edition, source_blob_sha: script.source_blob_sha,
    generated_at: new Date().toISOString(), chapters, sources: script.sources
  };
  await writeFile(path.join(root, metadata), `${JSON.stringify(info, null, 2)}\n`);
  await writeFile(path.join(root, transcript), `# ${script.title}\n\nVerslagperiode: ${script.period}. Duur: ${clock(duration)}.\n\n${script.disclosure}\n\n${script.sections.map((section) => `## ${section.title}\n\n${section.text}`).join("\n\n")}\n\n## Bronnen\n\n${script.sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `mp3=${mp3}\ntranscript=${transcript}\nmetadata=${metadata}\nduration=${clock(duration)}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Podcastaflevering\n\n${script.title}\n\n- Duur: ${clock(duration)}\n- Woorden: ${words}\n- Stem: ${voice} (AI), rustig tempo zonder versnelling achteraf.\n- Beschikbaar om te beluisteren en beoordelen.\n`);
  }
  const repository = process.env.GITHUB_REPOSITORY || "FkoNL/politiek-in-perspectief";
  const branch = process.env.PODCAST_BRANCH || `podcast-aflevering-${process.env.GITHUB_RUN_ID || "lokaal"}`;
  await writeFile(path.join(process.env.RUNNER_TEMP || work, "podcast-aflevering-pr.md"), `Aflevering op basis van de editie van ${date}, met de gekozen AI-stem Marin en de rustige aansturing. Er wordt geen versnelling achteraf toegepast.\n\nDuur: **${clock(duration)}**.\n\n[Beluister of download de MP3](https://raw.githubusercontent.com/${repository}/${branch}/${mp3}) · [Lees het script](https://github.com/${repository}/blob/${branch}/${transcript})\n\n${script.disclosure}\n\nDeze aflevering is automatisch aangemaakt na de gepubliceerde maandageditie en staat klaar voor beoordeling.\n`);
  console.log(`Podcastaflevering klaar: ${mp3} (${clock(duration)}).`);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await generatePodcastTrial();
}
