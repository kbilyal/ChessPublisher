(() => {
  "use strict";

  const REPO = "kbilyal/ChessPublisher";
  const API_ROOT = `https://api.github.com/repos/${REPO}`;
  const MAX_VISIBLE = 6;
  const FETCH_COUNT = MAX_VISIBLE + 1;

  const host = () => document.getElementById("releaseNotesContent");

  function esc(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(d);
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n) return "";
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${n} B`;
  }

  function cleanBody(body = "") {
    return String(body)
      .replace(/^\s*\*{0,2}Full Changelog\*{0,2}\s*:\s*https?:\/\/\S+\s*$/gim, "")
      .replace(/^\s*Full Changelog\s*:\s*https?:\/\/\S+\s*$/gim, "")
      .trim();
  }

  function mdToHtml(markdown = "") {
    let src = cleanBody(markdown);
    if (!src) return "";

    // Normalize the plain-text Release Notes format used by Publish-Release.bat.
    src = src
      .replace(/^([A-Z][A-Z0-9 /&<>-]{2,})\r?\n=+$/gm, "## $1")
      .replace(/^SHA256:$/gm, "**SHA-256**");

    src = esc(src)
      .replace(/^###\s+(.+)$/gm, "<h5>$1</h5>")
      .replace(/^##\s+(.+)$/gm, "<h4>$1</h4>")
      .replace(/^#\s+(.+)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

    const lines = src.split(/\r?\n/);
    let out = "";
    let listOpen = false;

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (/^\s*[-*]\s+/.test(line)) {
        if (!listOpen) {
          out += "<ul>";
          listOpen = true;
        }
        out += `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`;
        continue;
      }

      if (listOpen) {
        out += "</ul>";
        listOpen = false;
      }

      if (!line.trim()) continue;
      if (/^<h[3-5]>/.test(line)) out += line;
      else out += `<p>${line}</p>`;
    }

    if (listOpen) out += "</ul>";
    return out;
  }

  function asset(release, type) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const lower = a => String(a?.name || "").toLowerCase();

    if (type === "exe")
      return assets.find(a => lower(a).endsWith(".exe") && !lower(a).includes("sha")) || null;
    if (type === "zip")
      return assets.find(a => lower(a).endsWith(".zip") && !lower(a).includes("source code")) || null;
    if (type === "sha")
      return assets.find(a => /(sha-?256|checksum)/i.test(a?.name || "") && /\.(txt|sha256)$/i.test(a?.name || "")) || null;

    return null;
  }

  function assetButtons(release) {
    const exe = asset(release, "exe");
    const zip = asset(release, "zip");
    const sha = asset(release, "sha");
    const buttons = [];

    if (exe) {
      buttons.push(`<a class="release-asset" href="${esc(exe.browser_download_url)}">
        Windows installer${exe.size ? ` · ${formatBytes(exe.size)}` : ""}
      </a>`);
    }
    if (zip) {
      buttons.push(`<a class="release-asset" href="${esc(zip.browser_download_url)}">
        Portable ZIP${zip.size ? ` · ${formatBytes(zip.size)}` : ""}
      </a>`);
    }
    if (sha) {
      buttons.push(`<a class="release-asset" href="${esc(sha.browser_download_url)}">SHA-256</a>`);
    }

    return buttons.join("");
  }

  function releaseMarkup(release, index, previousRelease) {
    const tag = String(release.tag_name || release.name || "").trim();
    const version = tag.replace(/^v/i, "");
    const isLatest = index === 0;
    const bodyNotes = cleanBody(release.body || "");
    const effectiveNotes = bodyNotes;
    const notes = mdToHtml(effectiveNotes);
    const previousTag = previousRelease?.tag_name || "";

    return `
      <article class="release-history-item${isLatest ? " is-latest" : ""}">
        <details
          class="release-details"
          data-current-tag="${esc(tag)}"
          data-previous-tag="${esc(previousTag)}"
          data-has-notes="${notes ? "1" : "0"}"
          ${isLatest ? "open" : ""}>
          <summary>
            <span class="release-history-title">
              <strong>Chess-Publisher v${esc(version)}</strong>
              ${isLatest ? `<span class="release-latest-badge">Latest</span>` : ""}
            </span>
            <span class="release-history-date">${esc(formatDate(release.published_at || release.created_at))}</span>
          </summary>
          <div class="release-details-body">
            ${assetButtons(release) ? `<div class="release-assets">${assetButtons(release)}</div>` : ""}
            <div class="release-notes-body">
              ${notes || `<div class="release-commit-fallback" data-commit-fallback>
                <p class="release-loading-inline">Loading included changes…</p>
              </div>`}
            </div>
          </div>
        </details>
      </article>
    `;
  }

  function commitListHtml(commits) {
    const meaningful = (commits || [])
      .map(c => String(c?.commit?.message || "").split(/\r?\n/)[0].trim())
      .filter(Boolean)
      .filter(msg => !/^merge\b/i.test(msg));

    if (!meaningful.length) {
      return `<p class="release-empty">No detailed Release Notes were recorded for this version.</p>`;
    }

    return `
      <div class="release-generated-notes">
        <h4>Changes included in this version</h4>
        <ul>${meaningful.slice(0, 30).map(msg => `<li>${esc(msg)}</li>`).join("")}</ul>
      </div>
    `;
  }

  async function loadCompare(details) {
    if (!details || details.dataset.hasNotes === "1" || details.dataset.compareLoaded === "1") return;

    const current = details.dataset.currentTag || "";
    const previous = details.dataset.previousTag || "";
    const target = details.querySelector("[data-commit-fallback]");
    if (!target) return;

    details.dataset.compareLoaded = "1";

    if (!current || !previous) {
      target.innerHTML = `<p class="release-empty">No detailed Release Notes were recorded for this version.</p>`;
      return;
    }

    try {
      const url = `${API_ROOT}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(current)}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "Accept": "application/vnd.github+json" }
      });
      if (!res.ok) throw new Error(`GitHub compare ${res.status}`);
      const data = await res.json();
      target.innerHTML = commitListHtml(data.commits || []);
    } catch (err) {
      console.warn("Could not load release commit fallback:", err);
      target.innerHTML = `<p class="release-empty">Detailed Release Notes are not available right now.</p>`;
    }
  }

  function bindLazyCompare() {
    document.querySelectorAll(".release-details").forEach(details => {
      details.addEventListener("toggle", () => {
        if (details.open) loadCompare(details);
      });
      if (details.open) loadCompare(details);
    });
  }

  async function loadReleases() {
    const container = host();
    if (!container) return;

    try {
      const res = await fetch(`${API_ROOT}/releases?per_page=${FETCH_COUNT}`, {
        cache: "no-store",
        headers: { "Accept": "application/vnd.github+json" }
      });

      if (!res.ok) throw new Error(`GitHub Releases ${res.status}`);

      const all = (await res.json())
        .filter(r => !r.draft && !r.prerelease);

      if (!all.length) {
        container.innerHTML = `<div class="release-error-state">No published stable releases are available yet.</div>`;
        return;
      }

      const visible = all.slice(0, MAX_VISIBLE);
      container.innerHTML = visible.map((release, index) =>
        releaseMarkup(release, index, all[index + 1] || null)
      ).join("");

      bindLazyCompare();
    } catch (err) {
      console.warn("Could not load release history:", err);
      container.innerHTML = `
        <div class="release-error-state">
          Release history could not be loaded right now. Please refresh the page in a moment.
        </div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", loadReleases);
})();