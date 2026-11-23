const searchButton = document.querySelector('.search');
const dialog = document.querySelector('dialog');
const search = dialog.querySelector('input');
const results = document.querySelector('#results');
const menu = document.querySelector('.menu');
const sidebar = document.querySelector('#sidebar');
const home = new URL(document.body.dataset.index, document.baseURI);

function showResults() {
  const query = search.value.toLowerCase().trim();
  const terms = query.split(/\s+/);
  const matches = [];
  for (const page of window.docsIndex) {
    if (!query || page.title.toLowerCase().includes(query)) {
      matches.push({ label: page.title, detail: page.group, href: page.path, priority: 0 });
    }
    if (!query) continue;
    for (const heading of page.headings) {
      const titleMatch = heading.label.toLowerCase().includes(query);
      const body = heading.text.toLowerCase();
      if (titleMatch || terms.every(term => body.includes(term))) {
        matches.push({ label: heading.label, detail: page.title, href: page.path+'#'+heading.id, priority: titleMatch ? 1 : 2 });
      }
    }
  }
  results.replaceChildren();
  for (const match of matches.sort((a,b)=>a.priority-b.priority).slice(0,24)) {
    const item = document.createElement('a');
    item.href = new URL(match.href, home).href;
    item.append(document.createTextNode(match.label));
    const detail = document.createElement('small');
    detail.textContent = match.detail;
    item.append(detail);
    results.append(item);
  }
  if (!matches.length) results.textContent = 'No matching guide or section.';
}
function openSearch() {
  search.value = '';
  showResults();
  dialog.showModal();
  search.focus();
}
function setMenu(open) {
  sidebar.classList.toggle('open', open);
  menu.setAttribute('aria-expanded', String(open));
}
menu.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
document.querySelector('main').addEventListener('click', () => setMenu(false));
searchButton.addEventListener('click', openSearch);
search.addEventListener('input', showResults);
search.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('a')?.focus(); }
  if (event.key === 'Enter') results.querySelector('a')?.click();
});
dialog.querySelector('.close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => searchButton.focus());
results.addEventListener('click', event => {
  if (event.target.closest('a')) dialog.close();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !dialog.open && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    openSearch();
  }
  if (event.key === 'Escape') setMenu(false);
});
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const code = button.closest('.sample').querySelector('code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = 'Code selected';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
});
