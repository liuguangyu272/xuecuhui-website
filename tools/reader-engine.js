import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import 'katex/contrib/mhchem';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import SmilesDrawer from 'smiles-drawer';

export const defaultWatermark = '中国药科大学药学院 · 学促会';

export function watermarkSettings(library = {}, doc = {}) {
  const global = library.watermark || {};
  const local = doc.watermark || {};
  return {
    enabled: typeof local.enabled === 'boolean' ? local.enabled : global.enabled !== false,
    text: String(local.text || global.text || defaultWatermark).slice(0, 80)
  };
}

export function applyWatermark(host, settings) {
  host.querySelector(':scope > .reader-watermark')?.remove();
  if (!settings.enabled || !settings.text) return;
  const layer = document.createElement('div');
  layer.className = 'reader-watermark';
  layer.setAttribute('aria-hidden', 'true');
  // SVG textContent avoids inserting user-provided markup into a data URL.
  const tile = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tile.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  tile.setAttribute('width', '420'); tile.setAttribute('height', '260');
  const text = document.createElementNS(tile.namespaceURI, 'text');
  text.setAttribute('x', '210'); text.setAttribute('y', '130');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('transform', 'rotate(-25 210 130)');
  text.setAttribute('fill', '#14564a'); text.setAttribute('fill-opacity', '0.11');
  text.setAttribute('font-size', '17');
  text.setAttribute('font-family', 'Microsoft YaHei, PingFang SC, sans-serif');
  text.setAttribute('textLength', String(Math.min(360, settings.text.length * 17)));
  text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  text.textContent = settings.text;
  tile.appendChild(text);
  layer.style.backgroundImage = 'url("data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(tile)) + '")';
  host.appendChild(layer);
}

export function renderMarkdown(container, source, baseURL) {
  const md = new MarkdownIt({
    html: false, linkify: true, typographer: false,
    highlight(code, lang) {
      return lang && hljs.getLanguage(lang) ? hljs.highlight(code, {language: lang, ignoreIllegals: true}).value : '';
    }
  }).use(texmath, {
    engine: katex, delimiters: ['dollars', 'brackets', 'beg_end'],
    katexOptions: {trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20, strict: 'ignore'}
  });
  const fence = md.renderer.rules.fence;
  const molecules = [];
  md.renderer.rules.fence = (tokens, i, options, env, self) => {
    const token = tokens[i];
    const lang = token.info.trim().toLowerCase();
    if (lang === 'smiles') {
      const index = molecules.push(token.content.trim()) - 1;
      return '<figure class="molecule" data-molecule="' + index + '"><div class="molecule-drawing"></div><figcaption>分子结构</figcaption></figure>';
    }
    if (lang === 'math' || lang === 'latex') {
      return '<div class="math-block">' + katex.renderToString(token.content, {displayMode: true, throwOnError: false, trust: false, maxExpand: 1000, maxSize: 20}) + '</div>';
    }
    return fence(tokens, i, options, env, self);
  };
  const safe = DOMPurify.sanitize(md.render(source), {USE_PROFILES: {html: true, svg: true, mathMl: true}, ADD_TAGS: ['eq', 'eqn', 'semantics', 'annotation'], ADD_ATTR: ['encoding'], SANITIZE_NAMED_PROPS: true});
  container.innerHTML = safe;
  // Resolve Markdown attachments against the original document, not the reader page.
  container.querySelectorAll('a[href],img[src]').forEach(el => {
    const attr = el.tagName === 'A' ? 'href' : 'src';
    const value = el.getAttribute(attr);
    if (value.startsWith('#')) return;
    try {
      const url = new URL(value, baseURL);
      if (!['http:', 'https:', ...(attr === 'href' ? ['mailto:'] : [])].includes(url.protocol)) { el.removeAttribute(attr); return; }
      el.setAttribute(attr, url.href);
      if (attr === 'href') { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      else { el.loading = 'lazy'; el.decoding = 'async'; }
    } catch { el.removeAttribute(attr); }
  });
  const headings = [];
  let sectionIndex = 0, subsectionIndex = 0;
  container.querySelectorAll('h1,h2,h3,h4').forEach(el => {
    el.id = el.tagName === 'H4' ? 'subsection-' + subsectionIndex++ : 'section-' + sectionIndex++;
    const label = el.cloneNode(true);
    // The visual KaTeX tree is already sanitized. Preserve it in the TOC;
    // MathML textContent can also contain the original TeX annotation.
    label.querySelectorAll('.katex-mathml').forEach(math => math.remove());
    label.querySelectorAll('[aria-hidden]').forEach(node => node.removeAttribute('aria-hidden'));
    label.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    label.querySelectorAll('a').forEach(link => link.replaceWith(...link.childNodes));
    label.querySelectorAll('img').forEach(image => image.replaceWith(document.createTextNode(image.alt)));
    headings.push({id: el.id, text: label.textContent, html: label.innerHTML, level: Number(el.tagName[1])});
  });
  container.querySelectorAll('[data-molecule]').forEach(el => {
    const smiles = molecules[Number(el.dataset.molecule)];
    const target = el.querySelector('.molecule-drawing');
    try {
      if (!smiles || smiles.length > 2000) throw Error('结构数据为空或过长');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'mol-' + Math.random().toString(36).slice(2);
      target.appendChild(svg);
      new SmilesDrawer.SmiDrawer({width: 480, height: 280, compactDrawing: false}).draw(smiles, svg, 'light', () => {
        svg.style.width = Math.min(480, Math.max(160, svg.viewBox.baseVal.width * 1.2)) + 'px';
        svg.style.maxWidth = '100%';
      }, () => {
        target.textContent = '结构式无法解析，请检查 SMILES：' + smiles;
        target.classList.add('reader-error');
      });
    } catch {
      target.textContent = '结构式无法解析，请检查 SMILES：' + smiles;
      target.classList.add('reader-error');
    }
  });
  container.querySelectorAll('pre').forEach(pre => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'code-copy'; button.textContent = '复制';
    button.onclick = async () => {
      try {
        const text = pre.querySelector('code').textContent;
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else {
          const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
          document.body.appendChild(area); area.select();
          const copied = document.execCommand('copy'); area.remove();
          if (!copied) throw Error('copy failed');
        }
        button.textContent = '已复制';
      } catch { button.textContent = '请选中文字复制'; }
      setTimeout(() => {button.textContent = '复制';}, 1800);
    };
    pre.appendChild(button);
  });
  return headings;
}
