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
  }).replace(/\s+([,.!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return { text, sources };
}

export function renderStory(story, index) {
  const body = separateCitations(story.body);
  const why = separateCitations(story.why);
  const sources = new Map();
  for (const value of [...(story.sources ?? []), ...body.sources, ...why.sources]) {
    const source = sourceLink(value);
    if (source && !sources.has(source.url)) sources.set(source.url, source);
  }
  const links = [...sources.values()].map((source) =>
    `<a href="${escape(source.url)}" rel="noopener noreferrer">${escape(source.title)}</a>`
  ).join('<span aria-hidden="true"> · </span>');
  const sourceHtml = links ? `<p class="article-sources"><span>${sources.size === 1 ? "Bron" : "Bronnen"}:</span> ${links}</p>` : "";
  return `<article class="news-item">
        <p class="news-meta">${String(index + 1).padStart(2, "0")} · ${escape(story.kicker)}</p>
        <h3>${escape(story.headline)}</h3>
        <p class="news-copy">${escape(body.text)}</p>
        <div class="question"><h4>Waarom dit telt</h4><p>${escape(why.text)}</p></div>
        ${sourceHtml}
      </article>`;
}
