const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const markdownit = require('markdown-it');
const hljs = require('highlight.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Data directory
const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '/home/xisang', '.epub-maker');
const BOOKS_DIR = path.join(DATA_DIR, 'books');
const BOOKS_INDEX = path.join(DATA_DIR, 'books.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BOOKS_DIR)) fs.mkdirSync(BOOKS_DIR, { recursive: true });

// Initialize books index
if (!fs.existsSync(BOOKS_INDEX)) {
  fs.writeFileSync(BOOKS_INDEX, JSON.stringify([], null, 2));
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const bookId = req.params.id;
    const imagesDir = path.join(BOOKS_DIR, bookId, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// markdown-it setup with highlight.js
const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch (__) {}
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  }
});

// Helper functions
function getBooksIndex() {
  return JSON.parse(fs.readFileSync(BOOKS_INDEX, 'utf-8'));
}

function saveBooksIndex(books) {
  fs.writeFileSync(BOOKS_INDEX, JSON.stringify(books, null, 2));
}

function getBookDir(bookId) {
  return path.join(BOOKS_DIR, bookId);
}

function getBookMeta(bookId) {
  const metaPath = path.join(getBookDir(bookId), 'meta.json');
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return null;
}

function getChaptersJson(bookId) {
  const chaptersPath = path.join(getBookDir(bookId), 'chapters.json');
  if (fs.existsSync(chaptersPath)) {
    return JSON.parse(fs.readFileSync(chaptersPath, 'utf-8'));
  }
  return [];
}

function saveChaptersJson(bookId, chapters) {
  const chaptersPath = path.join(getBookDir(bookId), 'chapters.json');
  fs.writeFileSync(chaptersPath, JSON.stringify(chapters, null, 2));
}

// ============ API ROUTES ============

// GET /api/books - List all books
app.get('/api/books', (req, res) => {
  let books = getBooksIndex();
  // Filter out orphaned entries (books whose directories no longer exist)
  books = books.filter(b => fs.existsSync(getBookDir(b.id)));
  // Sort by updatedAt descending (most recent first)
  books.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(books);
});

// Book templates
const BOOK_TEMPLATES = {
  blank: {
    chapters: []
  },
  novel: {
    chapters: [
      { title: '第一章 序幕', content: '# 第一章 序幕\n\n故事从这里开始。\n\n' },
      { title: '第二章 发展', content: '# 第二章 发展\n\n情节逐渐展开。\n\n' },
      { title: '第三章 高潮', content: '# 第三章 高潮\n\n故事达到顶点。\n\n' },
      { title: '第四章 结局', content: '# 第四章 结局\n\n故事迎来尾声。\n\n' }
    ]
  },
  thesis: {
    chapters: [
      { title: '摘要', content: '# 摘要\n\n本文研究了...。\n\n' },
      { title: '第一章 引言', content: '# 第一章 引言\n\n1.1 研究背景\n\n国内外研究现状表明...。\n\n1.2 研究意义\n\n本研究具有重要的理论价值和实践意义。\n\n' },
      { title: '第二章 理论框架', content: '# 第二章 理论框架\n\n2.1 核心概念\n\n本研究所涉及的核心概念包括...。\n\n2.2 理论基础\n\n本研究的理论基础是...。\n\n' },
      { title: '第三章 研究方法', content: '# 第三章 研究方法\n\n3.1 研究设计\n\n本研究采用...方法。\n\n\n3.2 数据收集\n\n数据来源于...。\n\n' },
      { title: '第四章 结论', content: '# 第四章 结论\n\n本研究的主要结论是...。\n\n' },
      { title: '参考文献', content: '# 参考文献\n\n[1] 作者. 题目. 期刊, 年份.\n\n' }
    ]
  },
  poetry: {
    chapters: [
      { title: '第一篇 春', content: '# 春\n\n春风拂面万物苏，\n桃花盛开映山红。\n\n' },
      { title: '第二篇 夏', content: '# 夏\n\n烈日炎炎照大地，\n蝉鸣声声入梦来。\n\n' },
      { title: '第三篇 秋', content: '# 秋\n\n金风送爽叶飘零，\n丰收季节喜盈盈。\n\n' },
      { title: '第四篇 冬', content: '# 冬\n\n白雪皑皑覆山川，\n寒梅傲雪独自开。\n\n' }
    ]
  }
};

// POST /api/books - Create new book
app.post('/api/books', (req, res) => {
  const { title, template = 'blank' } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const id = uuidv4();
  const bookDir = getBookDir(id);
  const now = new Date().toISOString();

  // Create book directory structure
  fs.mkdirSync(path.join(bookDir, 'chapters'), { recursive: true });
  fs.mkdirSync(path.join(bookDir, 'images'), { recursive: true });

  // Create meta.json
  const meta = {
    id,
    title,
    author: '',
    cover: '',
    language: 'zh',
    createdAt: now,
    updatedAt: now
  };
  fs.writeFileSync(path.join(bookDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // Create chapters from template
  const templateData = BOOK_TEMPLATES[template] || BOOK_TEMPLATES.blank;
  const chapters = [];
  templateData.chapters.forEach((ch, idx) => {
    const chapterId = `chapter-${idx + 1}`;
    const fileName = `${chapterId}.md`;
    const filePath = path.join(bookDir, 'chapters', fileName);
    fs.writeFileSync(filePath, ch.content);
    chapters.push({
      id: chapterId,
      title: ch.title,
      file: `chapters/${fileName}`,
      order: idx + 1
    });
  });
  saveChaptersJson(id, chapters);

  // Update books index
  const books = getBooksIndex();
  books.push({
    id,
    title,
    path: `books/${id}/`,
    updatedAt: now
  });
  saveBooksIndex(books);

  res.json(meta);
});

// GET /api/books/:id - Get book info
app.get('/api/books/:id', (req, res) => {
  const { id } = req.params;
  const meta = getBookMeta(id);
  if (!meta) return res.status(404).json({ error: 'Book not found' });

  // Update the book's updatedAt in index
  const books = getBooksIndex();
  const bookIndex = books.findIndex(b => b.id === id);
  if (bookIndex !== -1) {
    books[bookIndex].updatedAt = new Date().toISOString();
    saveBooksIndex(books);
  }

  res.json(meta);
});

// PUT /api/books/:id - Update book metadata
app.put('/api/books/:id', (req, res) => {
  const { id } = req.params;
  const { title, author, cover, language } = req.body;

  const meta = getBookMeta(id);
  if (!meta) return res.status(404).json({ error: 'Book not found' });

  if (title !== undefined) meta.title = title;
  if (author !== undefined) meta.author = author;
  if (cover !== undefined) meta.cover = cover;
  if (language !== undefined) meta.language = language;
  meta.updatedAt = new Date().toISOString();

  fs.writeFileSync(path.join(getBookDir(id), 'meta.json'), JSON.stringify(meta, null, 2));

  // Update title in index
  const books = getBooksIndex();
  const bookIndex = books.findIndex(b => b.id === id);
  if (bookIndex !== -1) {
    books[bookIndex].title = meta.title;
    books[bookIndex].updatedAt = meta.updatedAt;
    saveBooksIndex(books);
  }

  res.json(meta);
});

// DELETE /api/books/:id - Delete book
app.delete('/api/books/:id', (req, res) => {
  const { id } = req.params;
  const bookDir = getBookDir(id);

  if (!fs.existsSync(bookDir)) {
    return res.status(404).json({ error: 'Book not found' });
  }

  // Delete book directory
  fs.rmSync(bookDir, { recursive: true, force: true });

  // Update index
  const books = getBooksIndex().filter(b => b.id !== id);
  saveBooksIndex(books);

  res.json({ success: true });
});

// GET /api/books/:id/chapters - Get chapter list
app.get('/api/books/:id/chapters', (req, res) => {
  const { id } = req.params;
  if (!fs.existsSync(getBookDir(id))) {
    return res.status(404).json({ error: 'Book not found' });
  }
  res.json(getChaptersJson(id));
});

// POST /api/books/:id/chapters - Create chapter
app.post('/api/books/:id/chapters', (req, res) => {
  const { id } = req.params;
  const { title, content = '' } = req.body;

  if (!fs.existsSync(getBookDir(id))) {
    return res.status(404).json({ error: 'Book not found' });
  }

  const chapters = getChaptersJson(id);
  const chapterId = `chapter-${chapters.length + 1}`;
  const fileName = `${chapterId}.md`;
  const filePath = path.join(getBookDir(id), 'chapters', fileName);

  // Write chapter content
  const chapterContent = content || `# ${title || 'Untitled Chapter'}\n\n`;
  fs.writeFileSync(filePath, chapterContent);

  // Create chapter entry
  const chapter = {
    id: chapterId,
    title: title || 'Untitled Chapter',
    file: `chapters/${fileName}`,
    order: chapters.length + 1
  };
  chapters.push(chapter);
  saveChaptersJson(id, chapters);

  res.json(chapter);
});

// GET /api/books/:id/chapters/:chapterId - Get chapter content
app.get('/api/books/:id/chapters/:chapterId', (req, res) => {
  const { id, chapterId } = req.params;
  const chapters = getChaptersJson(id);
  const chapter = chapters.find(c => c.id === chapterId);

  if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

  const filePath = path.join(getBookDir(id), chapter.file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Chapter file not found' });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ ...chapter, content });
});

// PUT /api/books/:id/chapters/:chapterId - Update chapter
app.put('/api/books/:id/chapters/:chapterId', (req, res) => {
  const { id, chapterId } = req.params;
  const { title, content } = req.body;

  const chapters = getChaptersJson(id);
  const chapterIndex = chapters.findIndex(c => c.id === chapterId);

  if (chapterIndex === -1) return res.status(404).json({ error: 'Chapter not found' });

  const chapter = chapters[chapterIndex];

  if (title !== undefined) chapter.title = title;
  if (content !== undefined) {
    const filePath = path.join(getBookDir(id), chapter.file);
    fs.writeFileSync(filePath, content);
  }

  chapters[chapterIndex] = chapter;
  saveChaptersJson(id, chapters);

  // Update book's updatedAt
  const meta = getBookMeta(id);
  if (meta) {
    meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(getBookDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
  }

  res.json(chapter);
});

// DELETE /api/books/:id/chapters/:chapterId - Delete chapter
app.delete('/api/books/:id/chapters/:chapterId', (req, res) => {
  const { id, chapterId } = req.params;

  let chapters = getChaptersJson(id);
  const chapterIndex = chapters.findIndex(c => c.id === chapterId);

  if (chapterIndex === -1) return res.status(404).json({ error: 'Chapter not found' });

  const chapter = chapters[chapterIndex];
  const filePath = path.join(getBookDir(id), chapter.file);

  // Delete file
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // Remove from list and reorder
  chapters.splice(chapterIndex, 1);
  chapters.forEach((ch, idx) => ch.order = idx + 1);
  saveChaptersJson(id, chapters);

  res.json({ success: true });
});

// PUT /api/books/:id/chapters/reorder - Reorder chapters
app.put('/api/books/:id/chapters/reorder', (req, res) => {
  const { id } = req.params;
  const { orderedIds } = req.body; // Array of chapter IDs in new order

  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds must be an array' });
  }

  let chapters = getChaptersJson(id);
  const reordered = [];
  orderedIds.forEach((chId, idx) => {
    const ch = chapters.find(c => c.id === chId);
    if (ch) {
      ch.order = idx + 1;
      reordered.push(ch);
    }
  });

  saveChaptersJson(id, reordered);
  res.json(reordered);
});

// POST /api/books/:id/upload - Upload image
app.post('/api/books/:id/upload', upload.single('image'), (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const imagePath = `images/${req.file.filename}`;
  res.json({
    path: imagePath,
    url: `/uploads/${id}/${req.file.filename}`,
    filename: req.file.filename
  });
});

// GET /api/books/:id/images - List images
app.get('/api/books/:id/images', (req, res) => {
  const { id } = req.params;
  const imagesDir = path.join(getBookDir(id), 'images');

  if (!fs.existsSync(imagesDir)) {
    return res.json([]);
  }

  const files = fs.readdirSync(imagesDir).map(filename => ({
    filename,
    path: `images/${filename}`,
    url: `/uploads/${id}/${filename}`
  }));

  res.json(files);
});

// DELETE /api/books/:id/images/:filename - Delete image
app.delete('/api/books/:id/images/:filename', (req, res) => {
  const { id, filename } = req.params;
  const filePath = path.join(getBookDir(id), 'images', filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Image not found' });
  }

  fs.unlinkSync(filePath);
  res.json({ success: true });
});

// Serve uploaded images
app.get('/uploads/:id/:filename', (req, res) => {
  const filePath = path.join(BOOKS_DIR, req.params.id, 'images', req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Image not found');
  }
  res.sendFile(filePath);
});

// ============ EPUB EXPORT ============

// GET /api/books/:id/export - Export EPUB
app.get('/api/books/:id/export', async (req, res) => {
  const { id } = req.params;

  const meta = getBookMeta(id);
  if (!meta) return res.status(404).json({ error: 'Book not found' });
  if (!meta.title) return res.status(400).json({ error: 'Book title is required' });
  if (!meta.author) return res.status(400).json({ error: 'Book author is required' });

  const chapters = getChaptersJson(id);
  if (chapters.length === 0) return res.status(400).json({ error: 'Book has no chapters' });

  const bookDir = getBookDir(id);
  const zip = new AdmZip();

  // 1. mimetype (uncompressed)
  const mimetype = 'application/epub+zip';
  zip.addFile('mimetype', Buffer.from(mimetype), '', 0);

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));

  // 3. Prepare content
  const uuidValue = uuidv4();
  const lang = meta.language || 'zh';
  const title = meta.title;
  const author = meta.author;
  const now = new Date().toISOString();

  // 4. content.opf (manifest + spine)
  let manifestItems = [];
  let spineItems = [];
  let imageManifest = [];

  // Copy and process images
  const imagesDir = path.join(bookDir, 'images');
  if (fs.existsSync(imagesDir)) {
    const imageFiles = fs.readdirSync(imagesDir);
    for (const imgFile of imageFiles) {
      const imgPath = path.join(imagesDir, imgFile);
      const imgContent = fs.readFileSync(imgPath);
      const ext = path.extname(imgFile).toLowerCase();
      let mimeType = 'image/jpeg';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.svg') mimeType = 'image/svg+xml';

      const mediaItem = `images/${imgFile}`;
      zip.addFile(`OEBPS/${mediaItem}`, imgContent);
      imageManifest.push(`    <item id="${imgFile.replace(/[^a-zA-Z0-9]/g, '_')}" href="${mediaItem}" media-type="${mimeType}"/>`);
    }
  }

  // Process chapters
  for (const chapter of chapters) {
    const chapterFilePath = path.join(bookDir, chapter.file);
    if (!fs.existsSync(chapterFilePath)) continue;

    let mdContent = fs.readFileSync(chapterFilePath, 'utf-8');
    const chapterHtmlId = chapter.id;

    // Convert markdown footnotes to EPUB format
    const footnoteRegex = /\*\[(\d+)\]:\s*(.+)/g;
    const footnotes = [];
    let fnMatch;
    while ((fnMatch = footnoteRegex.exec(mdContent)) !== null) {
      footnotes.push({ id: fnMatch[1], text: fnMatch[2] });
    }
    mdContent = mdContent.replace(footnoteRegex, '');

    // Convert images to relative EPUB paths
    mdContent = mdContent.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      if (src.startsWith('data:')) {
        return match; // Keep base64 as is
      }
      return `![${alt}](OEBPS/${src})`;
    });

    // Convert markdown to HTML
    let htmlContent = md.render(mdContent);

    // Add footnote section if there are footnotes
    if (footnotes.length > 0) {
      const footnoteHtml = footnotes.map(fn =>
        `<li id="fn-${fn.id}"><p>${fn.text} <a href="#fnref-${fn.id}">↩</a></p></li>`
      ).join('\n');
      htmlContent += `<footer>\n<ol class="footnotes">\n${footnoteHtml}\n</ol>\n</footer>`;
    }

    // Convert footnote refs
    htmlContent = htmlContent.replace(/\*\[(\d+)\]\*/g, (match, num) =>
      `<sup id="fnref-${num}"><a href="#fn-${num}">${num}</a></sup>`
    );

    // Wrap in XHTML with proper class
    const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${chapter.title}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="chapter">
  <section class="chapter-content">
    ${htmlContent}
  </section>
</body>
</html>`;

    zip.addFile(`OEBPS/${chapter.file.replace('.md', '.xhtml')}`, Buffer.from(xhtmlContent));
    manifestItems.push(`    <item id="${chapter.id}" href="${chapter.file.replace('.md', '.xhtml')}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="${chapter.id}"/>`);
  }

  // Cover image
  if (meta.cover && fs.existsSync(path.join(bookDir, meta.cover))) {
    const coverContent = fs.readFileSync(path.join(bookDir, meta.cover));
    const ext = path.extname(meta.cover).toLowerCase();
    let mimeType = 'image/jpeg';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.svg') mimeType = 'image/svg+xml';

    const coverId = `cover-image`;
    zip.addFile(`OEBPS/${meta.cover}`, coverContent);
    imageManifest.push(`    <item id="${coverId}" href="${meta.cover}" media-type="${mimeType}"/>`);
  }

  const imagesManifest = imageManifest.length > 0 ? '\n' + imageManifest.join('\n') : '';
  const manifest = `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n    <item id="styles" href="styles.css" media-type="text/css"/>${imagesManifest}\n${manifestItems.join('\n')}`;

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:${uuidValue}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${now.split('.')[0]}Z</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>`;
  zip.addFile('OEBPS/content.opf', Buffer.from(contentOpf));

  // 5. toc.ncx
  const navPoints = chapters.map((ch, idx) => {
    const playOrder = idx + 1;
    return `    <navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${ch.title}</text></navLabel>
      <content src="${ch.file.replace('.md', '.xhtml')}"/>
    </navPoint>`;
  }).join('\n');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuidValue}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
  zip.addFile('OEBPS/toc.ncx', Buffer.from(tocNcx));

  // 6. nav.xhtml
  const navList = chapters.map(ch =>
    `      <li><a href="${ch.file.replace('.md', '.xhtml')}">${ch.title}</a></li>`
  ).join('\n');

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${title}</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>`;
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(navXhtml));

  // 7. styles.css
  const stylesCss = `body {
  font-family: Georgia, serif;
  line-height: 1.6;
  margin: 1em;
  padding: 0;
}
h1, h2, h3, h4, h5, h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}
h1 { font-size: 2em; text-align: center; margin-bottom: 1em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }
p { margin: 0.5em 0; text-align: justify; }
pre {
  background-color: #f5f5f5;
  padding: 1em;
  overflow-x: auto;
  border-radius: 4px;
}
code {
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}
.chapter-content > p:first-child {
  text-indent: 2em;
}
.chapter-content > h1 + p,
.chapter-content > h2 + p,
.chapter-content > h3 + p {
  text-indent: 0;
}
blockquote {
  margin: 1em 2em;
  padding-left: 1em;
  border-left: 3px solid #ccc;
  font-style: italic;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}
th, td {
  border: 1px solid #ddd;
  padding: 0.5em;
  text-align: left;
}
th { background-color: #f5f5f5; }
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}
.footnotes {
  border-top: 1px solid #ccc;
  margin-top: 2em;
  padding-top: 1em;
  font-size: 0.9em;
}
.footnotes li {
  margin: 0.5em 0;
}
sup a {
  text-decoration: none;
  color: #0066cc;
}
footer {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid #ccc;
}`;
  zip.addFile('OEBPS/styles.css', Buffer.from(stylesCss));

  // Generate buffer and send
  const epubBuffer = zip.toBuffer();

  res.setHeader('Content-Type', 'application/epub+zip');
  res.setHeader('Content-Disposition', `attachment; filename="${title}.epub"`);
  res.send(epubBuffer);
});

// Start server
app.listen(PORT, () => {
  console.log(`EPUB Maker running at http://localhost:${PORT}`);
});
