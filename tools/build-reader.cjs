const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'web/assets/vendor');
function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.cpSync(source, destination, {recursive: true});
}
async function build() {
  const out = path.join(vendor, 'reader');
  fs.mkdirSync(out, {recursive: true});
  await esbuild.build({entryPoints: [path.join(__dirname, 'reader-engine.js')], outfile: path.join(out, 'engine.min.js'),
    bundle: true, format: 'iife', globalName: 'ReaderEngine', minify: true, target: 'es2020', legalComments: 'eof'});
  const modules = path.join(root, 'node_modules');
  copy(path.join(modules, 'katex/dist/katex.min.css'), path.join(out, 'katex.min.css'));
  copy(path.join(modules, 'katex/dist/fonts'), path.join(out, 'fonts'));
  copy(path.join(modules, 'highlight.js/styles/github.min.css'), path.join(out, 'highlight.css'));
  for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    copy(path.join(modules, 'pdfjs-dist/build', file), path.join(vendor, 'pdfjs', file.replace(/\.mjs$/, '.js')));
    const old = path.join(vendor, 'pdfjs', file);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  // .js has the correct JavaScript MIME type on existing Nginx installs.
  // The package marker also lets deployment's node --check validate the modules.
  fs.writeFileSync(path.join(vendor, 'pdfjs/package.json'), '{"type":"module"}\n');
  const pdfCSS = fs.readFileSync(path.join(modules, 'pdfjs-dist/web/pdf_viewer.css'), 'utf8');
  // Only the text layer is used; the full viewer stylesheet changes global UI styles.
  fs.writeFileSync(path.join(vendor, 'pdfjs/pdf_viewer.css'), '/* PDF.js text layer; Apache-2.0, Mozilla Foundation. */\n' + pdfCSS.slice(pdfCSS.indexOf('.textLayer {'), pdfCSS.indexOf('.annotationLayer {')));
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) copy(path.join(modules, 'pdfjs-dist', dir), path.join(vendor, 'pdfjs', dir));
  for (const [pkg, file] of [['markdown-it','LICENSE'],['katex','LICENSE'],['markdown-it-texmath','license.txt'],['highlight.js','LICENSE'],['dompurify','LICENSE'],['smiles-drawer','LICENSE'],['pdfjs-dist','LICENSE']]) {
    const source = path.join(modules, pkg, file);
    if (fs.existsSync(source)) copy(source, path.join(vendor, 'licenses', pkg + '.txt'));
  }
  copy(path.join(__dirname, 'licenses/smiles-drawer.txt'), path.join(vendor, 'licenses/smiles-drawer.txt'));
  console.log('Built reader engine, fonts and self-hosted PDF worker/assets.');
}
build().catch(error => {console.error(error); process.exit(1);});
