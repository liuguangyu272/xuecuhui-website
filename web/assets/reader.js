/* Document sources remain unchanged; watermarks belong to the reading surface. */
(() => {
  const $ = id => document.getElementById(id);
  const status = message => { $('readerStatus').textContent = message; $('readerStatus').hidden = !message; };

  async function openPDF(url, watermark) {
    const pdfjs = await import('./vendor/pdfjs/pdf.min.js');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.js', new URL('assets/reader.js', location.href)).href;
    const base = new URL('assets/vendor/pdfjs/', location.href).href;
    const loading = pdfjs.getDocument({url: url.href, cMapUrl: base + 'cmaps/', cMapPacked: true,
      standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', isEvalSupported: false});
    loading.onPassword = (update, reason) => {
      const password = window.prompt(reason === 2 ? '密码不正确，请重新输入 PDF 密码' : '此 PDF 需要密码');
      if (password === null) { loading.destroy(); status('已取消打开加密 PDF。'); }
      else update(password);
    };
    const pdf = await loading.promise;
    $('readerLayout').classList.add('reader-layout--pdf');
    $('readerToc').hidden = true; $('readerContent').remove();
    $('pdfControls').hidden = false;
    $('pdfPages').textContent = pdf.numPages; $('pdfPage').max = pdf.numPages;
    const sheet = $('readerSheet'); sheet.classList.add('reader-sheet--pdf');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    const text = document.createElement('div'); text.className = 'textLayer';
    sheet.append(canvas, text);
    ReaderEngine.applyWatermark(sheet, watermark);
    let pageNumber = 1, zoom = 1, generation = 0, queue = Promise.resolve();
    function schedule() {
      const current = ++generation;
      queue = queue.catch(() => {}).then(async () => {
        if (current !== generation) return;
        status('正在绘制第 ' + pageNumber + ' 页…');
        const page = await pdf.getPage(pageNumber);
        if (current !== generation) return;
        const natural = page.getViewport({scale: 1});
        const width = Math.max(240, $('pdfScroll').clientWidth);
        const viewport = page.getViewport({scale: Math.min(2, width / natural.width) * zoom});
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
        canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
        canvas.setAttribute('aria-label', 'PDF 第 ' + pageNumber + ' 页');
        sheet.style.width = viewport.width + 'px'; sheet.style.height = viewport.height + 'px';
        sheet.style.setProperty('--scale-factor', viewport.scale);
        sheet.style.setProperty('--total-scale-factor', viewport.scale);
        text.replaceChildren();
        await page.render({canvasContext: canvas.getContext('2d'), viewport,
          transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0]}).promise;
        try {
          const layer = new pdfjs.TextLayer({textContentSource: await page.getTextContent(), container: text, viewport});
          await layer.render();
        } catch (error) { console.warn('PDF text layer unavailable', error); }
        if (current !== generation) return;
        $('pdfPage').value = pageNumber;
        $('pdfPrev').disabled = pageNumber === 1; $('pdfNext').disabled = pageNumber === pdf.numPages;
        $('pdfZoom').textContent = zoom === 1 ? '适合宽度' : Math.round(zoom * 100) + '%';
        status('');
      }).catch(error => { console.error(error); status('这一页暂时无法显示，请重试或下载原文件。'); });
    }
    function go(number) {
      if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) { $('pdfPage').value = pageNumber; return; }
      pageNumber = number; schedule();
    }
    $('pdfPrev').onclick = () => go(pageNumber - 1);
    $('pdfNext').onclick = () => go(pageNumber + 1);
    $('pdfPage').onchange = e => go(Number(e.target.value));
    $('pdfZoomIn').onclick = () => { zoom = Math.min(2.5, zoom + .25); schedule(); };
    $('pdfZoomOut').onclick = () => { zoom = Math.max(.5, zoom - .25); schedule(); };
    $('pdfFit').onclick = () => { zoom = 1; schedule(); };
    let resizeTimer, lastWidth = 0;
    new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width; clearTimeout(resizeTimer); resizeTimer = setTimeout(schedule, 150);
    }).observe($('pdfScroll'));
    schedule();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const id = new URLSearchParams(location.search).get('id');
      await Store.load();
      const library = Store.library();
      const doc = (library.docs || []).find(item => item.id === id);
      if (!doc) throw Error('这份资料不存在或已被移除，请返回资料库重新选择。');
      const url = new URL(doc.url, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('资料地址无效。');
      const type = String(doc.ext || url.pathname.split('.').pop()).toLowerCase().replace(/^\./, '');
      document.title = doc.name + ' · 学习小站';
      $('readerTitle').textContent = doc.name;
      $('readerType').textContent = type === 'pdf' ? 'PDF · 在线阅读' : 'MARKDOWN · 在线阅读';
      $('readerMeta').textContent = [doc.grade, doc.subject, doc.note, doc.date].filter(Boolean).join(' · ');
      $('readerDownload').href = url.href; $('readerDownload').hidden = false;
      $('readerDownload').target = '_blank'; $('readerDownload').rel = 'noopener';
      const watermark = ReaderEngine.watermarkSettings(library, doc);
      $('readerFootnote').textContent = watermark.enabled ? '阅读水印：' + watermark.text + '。下载原文件保留原始内容。' : '下载原文件保留原始内容。';
      $('readerLayout').hidden = false;
      if (type === 'pdf') return await openPDF(url, watermark);
      if (!['md', 'markdown'].includes(type)) throw Error('此类型暂不支持在线阅读，请下载原文件。');
      const response = await fetch(url.href);
      if (!response.ok) throw Error('资料加载失败（' + response.status + '），请稍后重试。');
      if (Number(response.headers.get('Content-Length')) > 5 * 1024 * 1024) throw Error('文档较大，请下载原文件阅读。');
      const source = await response.text();
      if (source.length > 5 * 1024 * 1024) throw Error('文档较大，请下载原文件阅读。');
      const headings = ReaderEngine.renderMarkdown($('readerContent'), source, url.href);
      headings.forEach(heading => {
        const link = document.createElement('a'); link.href = '#' + heading.id;
        link.textContent = heading.text; link.dataset.level = heading.level;
        $('tocLinks').appendChild(link);
      });
      if (!headings.length) $('readerToc').hidden = true;
      ReaderEngine.applyWatermark($('readerSheet'), watermark);
      status('');
    } catch (error) {
      console.error(error);
      $('readerLayout').hidden = true;
      $('readerTitle').textContent = '暂时无法打开资料';
      status(error.message || '加载失败，请返回资料库重试。');
    }
  });
})();
