const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.site-nav');
if (toggle && nav) {
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));
}
const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

// Use the newest GitHub Release when one exists; the HTML links remain
// a safe fallback to the Releases page before the first release is published.
fetch('https://api.github.com/repos/kbilyal/ChessPublisher/releases/latest', {
  headers: { Accept: 'application/vnd.github+json' }
})
  .then(response => response.ok ? response.json() : null)
  .then(release => {
    if (!release || !release.html_url) return;
    document.querySelectorAll('[data-latest-release]').forEach(link => {
      link.href = release.html_url;
    });
  })
  .catch(() => {});
