import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const editionDirectory = path.join(root, "edities");
const imageDirectory = path.join(root, "assets", "edities");
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY ontbreekt. Voeg deze alleen toe als GitHub Secret.");
}

const today = new Date();
const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
const start = new Date(end);
start.setUTCDate(end.getUTCDate() - 6);

const iso = (date) => date.toISOString().slice(0, 10);
const dutchDate = (date) => new Intl.DateTimeFormat("nl-NL", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
}).format(date);
const range = `${dutchDate(start)}–${dutchDate(end)}`;
const editionId = iso(end);

const prompt = `Je bent eindredacteur van de onafhankelijke, Nederlandstalige wekelijkse site “Politiek in Perspectief”.

Maak een neutrale concepteditie voor ${range}. Zoek op het web en selecteer alleen ontwikkelingen uit deze periode die aantoonbaar relevant zijn voor Nederlandse politiek, Europees beleid of de relatie daartussen. Geef voorrang aan primaire bronnen: overheid.nl, rijksoverheid.nl, tweedekamer.nl, eerstekamer.nl, europa.eu, consilium.europa.eu, ec.europa.eu, cbs.nl en officiële publicaties. Gebruik andere betrouwbare bronnen alleen wanneer een primaire bron ontbreekt.

Maak geen speculaties, opinies of onbevestigde beweringen. Vermeld voorstellen nadrukkelijk als voorstel en besluiten als besluit. Kies maximaal 10 onderwerpen. Schrijf helder en rustig, zonder partijpolitieke kleur. Iedere opgenomen bewering moet door minstens één gevonden bron worden gedragen.

Geef uitsluitend geldig JSON terug, zonder markdown, volgens dit schema:
{
  "summary": "120-170 woorden",
  "stories": [{
    "section": "Nederland of Europa",
    "kicker": "korte categorie",
    "headline": "maximaal 90 tekens",
    "body": "100-150 woorden",
    "why": "één zin met waarom dit telt"
  }],
  "outlook": ["maximaal 5 concrete aandachtspunten voor komende week"]
}

Gebruik webzoeking verplicht en plaats de broncitaten bij de inhoud die zij ondersteunen.`;

const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: "gpt-5.5",
    tools: [{ type: "web_search", search_context_size: "high" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    input: prompt
  })
});

if (!response.ok) throw new Error(`OpenAI API-fout: ${response.status} ${await response.text()}`);
const result = await response.json();
const text = result.output_text?.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
let edition;
try {
  edition = JSON.parse(text);
} catch {
  throw new Error("De OpenAI-uitvoer was geen geldig JSON. Er is niets gepubliceerd.");
}

if (!edition.summary || !Array.isArray(edition.stories) || edition.stories.length === 0) {
  throw new Error("De concepteditie mist verplichte onderdelen. Er is niets gepubliceerd.");
}

const escape = (value = "") => String(value).replace(/[&<>\"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[character]);

const sources = new Map();
for (const item of result.output ?? []) {
  for (const content of item.content ?? []) {
    for (const annotation of content.annotations ?? []) {
      const citation = annotation.url_citation ?? annotation;
      if (citation.url) sources.set(citation.url, citation.title || citation.url);
    }
  }
  for (const source of item.action?.sources ?? []) {
    if (source.url) sources.set(source.url, source.title || source.url);
  }
}

const grouped = edition.stories.reduce((groups, story) => {
  const section = story.section === "Europa" ? "Europa" : "Nederland";
  (groups[section] ??= []).push(story);
  return groups;
}, {});
const sectionTitle = { Nederland: "Besluiten, geld en ruimte", Europa: "Veiligheid, industrie en de rekening" };

const storiesHtml = Object.entries(grouped).map(([section, stories]) => `
  <section class="news-section" id="${section.toLowerCase()}">
    <div class="section-inner">
      <p class="eyebrow">${section.toUpperCase()}</p>
      <h2>${sectionTitle[section]}</h2>
      ${stories.map((story, index) => `<article class="news-item">
        <p class="news-meta">${String(index + 1).padStart(2, "0")} · ${escape(story.kicker)}</p>
        <h3>${escape(story.headline)}</h3>
        <p class="news-copy">${escape(story.body)}</p>
        <p class="question"><span>WAAROM DIT TELT</span>${escape(story.why)}</p>
      </article>`).join("\n")}
    </div>
  </section>`).join("\n");

const sourceHtml = sources.size ? `<section class="sources shell" aria-labelledby="bronnen-title"><h2 id="bronnen-title">Bronnen bij deze editie</h2><ul>${[...sources].map(([url, title]) => `<li><a href="${escape(url)}" rel="noopener noreferrer">${escape(title)}</a></li>`).join("")}</ul></section>` : "";
const outlookHtml = (edition.outlook ?? []).slice(0, 5).map((item) => `<li>${escape(item)}</li>`).join("");
const illustrationPrompt = `Use case: stylized-concept. Asset type: editorial hero illustration for a Dutch public-affairs weekly. Primary request: create one calm, original visual metaphor for this week's political themes: ${edition.stories.slice(0, 5).map((story) => story.headline).join("; ")}. Style/medium: refined paper-cut editorial illustration with subtle ink texture, suitable for a serious European newspaper magazine. Composition/framing: horizontal landscape, clear focal point, spacious and calm. Color palette: moss green, warm off-white, muted rust orange and charcoal. Constraints: no people, no faces, no politician likenesses, no party symbols, no flags, no maps presented as fact, no text, no letters, no logos, no watermark, no photorealism.`;
const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: "gpt-image-2.5-flare",
    prompt: illustrationPrompt,
    size: "1536x1024",
    quality: "low",
    output_format: "webp",
    background: "opaque"
  })
});
if (!imageResponse.ok) throw new Error(`OpenAI afbeeldingsfout: ${imageResponse.status} ${await imageResponse.text()}`);
const image = await imageResponse.json();
if (!image.data?.[0]?.b64_json) throw new Error("De afbeeldings-API gaf geen illustratie terug.");
await mkdir(imageDirectory, { recursive: true });
const imageFile = `${editionId}.webp`;
await writeFile(path.join(imageDirectory, imageFile), Buffer.from(image.data[0].b64_json, "base64"));
const illustrationHtml = `<figure class="edition-illustration shell"><img src="assets/edities/${imageFile}" alt="Abstracte redactionele illustratie bij de politieke week van ${escape(range)}." width="1536" height="1024"><figcaption>Gegenereerde illustratie bij deze editie.</figcaption></figure>`;

const page = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Wekelijkse politieke context van ${range}."><title>Weekblad ${range} — Politiek in Perspectief</title><link rel="stylesheet" href="assets/styles.css"></head>
<body><a class="skip-link" href="#inhoud">Direct naar de inhoud</a><header class="site-header"><div class="shell header-inner"><a class="wordmark" href="index.html">Politiek <span>in Perspectief</span></a><nav aria-label="Hoofdnavigatie"><a href="index.html">Deze week</a><a href="archief.html">Archief</a><a href="#over">Over</a></nav></div></header>
<main id="inhoud"><section class="hero"><div class="shell hero-inner"><p class="eyebrow">WEEKBLAD · ${escape(range).toUpperCase()}</p><h1>De week, in het juiste perspectief.</h1><p class="intro">Een rustig overzicht van de belangrijkste politieke ontwikkelingen in Nederland en Europa — wat er is besloten, wat nog openligt en waarom dat ertoe doet.</p><a class="button" href="#samenvatting">Lees het overzicht</a></div></section>
${illustrationHtml}
<section class="brief shell" id="samenvatting"><p class="eyebrow">IN ÉÉN MINUUT</p><h2>De samenvatting</h2><p>${escape(edition.summary)}</p></section>
<nav class="edition-nav shell" aria-label="Onderwerpen in deze editie"><p>Onderwerpen in deze editie</p>${Object.keys(grouped).map((section) => `<a href="#${section.toLowerCase()}">${section}</a>`).join("")}<a href="#vooruitblik">Vooruitblik</a></nav>
${storiesHtml}
<section class="outlook shell" id="vooruitblik"><p class="eyebrow">VOORUITBLIK</p><h2>Waar we de komende weken op letten</h2><ol>${outlookHtml}</ol></section>${sourceHtml}
<section class="about shell" id="over"><p class="eyebrow">OVER DIT PROJECT</p><h2>Minder haast. Meer begrip.</h2><p>Politiek in Perspectief is een onafhankelijke, toegankelijke leesgids voor mensen die de Nederlandse politiek willen volgen zonder meegetrokken te worden in de waan van de dag.</p><p>We scheiden feiten, duiding en open vragen. Zo blijft er ruimte om zelf een oordeel te vormen.</p></section></main><footer class="site-footer"><div class="shell footer-inner"><p>Politiek in Perspectief</p><p>Onafhankelijke context bij de politiek.</p></div></footer></body></html>`;

await mkdir(editionDirectory, { recursive: true });
const firstEdition = path.join(editionDirectory, "2026-10-19.html");
try {
  await access(firstEdition);
} catch {
  const existingIndex = await readFile(path.join(root, "index.html"), "utf8");
  await writeFile(firstEdition, existingIndex.replaceAll('href="assets/styles.css"', 'href="../assets/styles.css"').replaceAll('href="index.html"', 'href="../index.html"').replaceAll('href="archief.html"', 'href="../archief.html"'));
}
await writeFile(path.join(root, "index.html"), page);
await writeFile(path.join(editionDirectory, `${editionId}.html`), page.replaceAll('href="assets/styles.css"', 'href="../assets/styles.css"').replaceAll('href="index.html"', 'href="../index.html"').replaceAll('href="archief.html"', 'href="../archief.html"').replaceAll('src="assets/', 'src="../assets/'));

const files = (await readdir(editionDirectory)).filter((file) => /^\d{4}-\d{2}-\d{2}\.html$/.test(file)).sort().reverse();
const archiveItems = await Promise.all(files.map(async (file) => {
  const html = await readFile(path.join(editionDirectory, file), "utf8");
  const title = html.match(/<title>Weekblad ([^<]+) —/)?.[1] ?? file.slice(0, -5);
  return `<article class="archive-item"><div><p class="eyebrow">${escape(title)}</p><h2>De week, in het juiste perspectief</h2><p>Een wekelijkse editie met politieke context, open vragen en bronnen.</p></div><a class="text-link" href="edities/${file}">Lees editie <span aria-hidden="true">→</span></a></article>`;
}));
const archive = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Het archief van Politiek in Perspectief."><title>Archief — Politiek in Perspectief</title><link rel="stylesheet" href="assets/styles.css"></head><body><a class="skip-link" href="#inhoud">Direct naar de inhoud</a><header class="site-header"><div class="shell header-inner"><a class="wordmark" href="index.html">Politiek <span>in Perspectief</span></a><nav aria-label="Hoofdnavigatie"><a href="index.html">Deze week</a><a aria-current="page" href="archief.html">Archief</a><a href="index.html#over">Over</a></nav></div></header><main id="inhoud" class="shell archive"><div class="archive-intro"><p class="eyebrow">ALLE EDITIES</p><h1>Archief</h1><p class="intro">Een groeiende verzameling van rustige, wekelijkse politieke context.</p></div><section class="archive-list" aria-label="Edities">${archiveItems.join("\n")}</section><p class="archive-note">Nieuwe edities verschijnen na redactionele controle.</p></main><footer class="site-footer"><div class="shell footer-inner"><p>Politiek in Perspectief</p><p>Onafhankelijke context bij de politiek.</p></div></footer></body></html>`;
await writeFile(path.join(root, "archief.html"), archive);

console.log(`Concepteditie ${editionId} aangemaakt met ${sources.size} bronvermeldingen.`);
