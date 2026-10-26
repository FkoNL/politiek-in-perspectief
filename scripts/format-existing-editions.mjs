import { readFile, readdir, writeFile } from "node:fs/promises";
import { renderStory } from "./render-story.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

const decode = (text) => text.replace(/&(amp|lt|gt|quot|#039);/g, (_, entity) => ({
  amp: "&", lt: "<", gt: ">", quot: '"', "#039": "'"
})[entity]);
const files = ["index.html", ...(await readdir(path.join(root, "edities"))).filter((file) => file.endsWith(".html")).map((file) => `edities/${file}`)];
for (const file of files) {
  const original = await readFile(path.join(root, file), "utf8");
  const formatted = original.replace(/<article class="news-item">[\s\S]*?<\/article>/g, (article) => {
    const meta = article.match(/<p class="news-meta">(\d+) · ([\s\S]*?)<\/p>/);
    const headline = article.match(/<h3>([\s\S]*?)<\/h3>/);
    const body = article.match(/<p class="news-copy">([\s\S]*?)<\/p>/);
    const why = article.match(/<p class="question"><span>WAAROM DIT TELT<\/span>([\s\S]*?)<\/p>/);
    if (!meta || !headline || !body || !why) return article;
    return renderStory({ kicker: decode(meta[2]), headline: decode(headline[1]), body: decode(body[1]), why: decode(why[1]) }, Number(meta[1]) - 1);
  });
  if (formatted !== original) {
    await writeFile(path.join(root, file), formatted);
    console.log(`Bijgewerkt: ${file}`);
  }
}
