const escape = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[character]);

function sourceLink(source) {
  try {
    const url = new URL(source.url);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return { url: url.href, title: source.title?.trim() || url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

// Older editions can contain Markdown citations in otherwise plain article text.
function separateCitations(value = "") {
  const sources = [];
  const text = String(value).replace(/\(?\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\)?/g, (match, title, url) => {
    const source = sourceLink({ title, url });
    if (!source) return match;
    sources.push(source);
    return "";
  }).replace(/[ \t]+([,.!?;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  return { text, sources };
}

export function storyId(story, index) {
  const section = ["Nederland", "Europa"].includes(story.section) ? story.section.toLowerCase() : "bericht";
  return `${section}-${index + 1}`;
}

function paragraphs(text, className = "") {
  return text.split(/\n\s*\n/).filter((part) => part.trim()).map((part) =>
    `<p${className ? ` class="${className}"` : ""}>${escape(part.trim())}</p>`
  ).join("\n");
}

export function renderStory(story, index) {
  const body = separateCitations(story.body);
  const why = separateCitations(story.why);
  const next = separateCitations(story.next);
  const watch = separateCitations(story.watch);
  const expanded = Boolean(next.text || watch.text);
  const sources = new Map();
  for (const value of [...(story.sources ?? []), ...body.sources, ...why.sources, ...next.sources, ...watch.sources]) {
    const source = sourceLink(value);
    if (source && !sources.has(source.url)) sources.set(source.url, source);
  }
  const links = [...sources.values()].map((source) =>
    `<a href="${escape(source.url)}" rel="noopener noreferrer">${escape(source.title)}</a>`
  ).join('<span aria-hidden="true"> · </span>');
  const sourceHtml = links ? `<p class="article-sources"><span>${sources.size === 1 ? "Bron" : "Bronnen"}:</span> ${links}</p>` : "";
  return `<article class="news-item" id="${storyId(story, index)}">
        <p class="news-meta">${String(index + 1).padStart(2, "0")} · ${escape(story.kicker)}</p>
        <h3>${escape(story.headline)}</h3>
        <div class="story-body">${expanded ? "<h4>Wat is er gebeurd?</h4>" : ""}${paragraphs(body.text, "news-copy")}</div>
        <div class="question"><h4>Waarom dit telt</h4>${paragraphs(why.text)}</div>
        ${next.text ? `<div class="story-follow-up"><h4>Wat volgt?</h4>${paragraphs(next.text)}</div>` : ""}
        ${watch.text ? `<div class="story-follow-up"><h4>Om te volgen</h4>${paragraphs(watch.text)}</div>` : ""}
        ${sourceHtml}
      </article>`;
}
