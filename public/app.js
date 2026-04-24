const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;

// Initialize markdown-it with highlight.js
const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code class="language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch (e) {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  }
});

// Parse footnotes from markdown
function parseFootnotes(content) {
  const footnotes = [];
  const footnoteRegex = /\*\[(\d+)\]:\s*(.+)/g;
  let match;
  while ((match = footnoteRegex.exec(content)) !== null) {
    footnotes.push({ id: match[1], text: match[2] });
  }
  return footnotes;
}

// Convert footnotes in content
function convertFootnotes(content) {
  // First extract and remove footnote definitions
  const footnotes = parseFootnotes(content);
  let result = content.replace(/\*\[(\d+)\]:\s*.+/g, '');

  // Convert footnote references
  result = result.replace(/\*\[(\d+)\]\*/g, (match, num) => {
    return `<sup id="fnref-${num}"><a href="#fn-${num}">${num}</a></sup>`;
  });

  return { content: result, footnotes };
}

// Render markdown to HTML with footnotes support
function renderMarkdown(content) {
  const { content: cleanContent, footnotes } = convertFootnotes(content);

  let html = md.render(cleanContent);

  // Add footnote section if there are footnotes
  if (footnotes.length > 0) {
    const footnoteHtml = footnotes.map(fn =>
      `<li id="fn-${fn.id}"><p>${fn.text} <a href="#fnref-${fn.id}">↩</a></p></li>`
    ).join('\n');
    html += `<footer class="footnotes">\n<ol>\n${footnoteHtml}\n</ol>\n</footer>`;
  }

  return html;
}

createApp({
  setup() {
    // State
    const books = ref([]);
    const currentBookId = ref(null);
    const chapters = ref([]);
    const currentChapterId = ref(null);
    const editorContent = ref('');
    const currentChapterTitle = ref('');
    const bookMeta = ref({ id: '', title: '', author: '', cover: '', language: 'zh' });
    const previewHtml = ref('');

    // UI State
    const showNewBookModal = ref(false);
    const newBookTitle = ref('');
    const showContextMenu = ref(false);
    const contextMenuX = ref(0);
    const contextMenuY = ref(0);
    const contextMenuBook = ref(null);
    const statusMessage = ref('');
    const statusType = ref('info');

    // Refs
    const newBookInput = ref(null);
    const editor = ref(null);
    const preview = ref(null);
    const coverInput = ref(null);
    const imageInput = ref(null);

    // Auto-save timer
    let saveTimer = null;
    let sortableInstance = null;

    // Computed
    const currentBook = computed(() => books.value.find(b => b.id === currentBookId.value));

    // API helpers
    async function apiGet(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    }

    async function apiPost(url, data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `API error: ${res.status}`);
      }
      return res.json();
    }

    async function apiPut(url, data) {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `API error: ${res.status}`);
      }
      return res.json();
    }

    async function apiDelete(url) {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      return res.json();
    }

    async function apiUpload(url, file) {
      const formData = new FormData();
      formData.append(file.fieldName || 'image', file);
      const res = await fetch(url, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload error: ${res.status}`);
      return res.json();
    }

    // Show status message
    function showStatus(msg, type = 'info') {
      statusMessage.value = msg;
      statusType.value = type;
      setTimeout(() => { statusMessage.value = ''; }, 3000);
    }

    // Load books
    async function loadBooks() {
      try {
        books.value = await apiGet('/api/books');
        if (books.value.length > 0 && !currentBookId.value) {
          await selectBook(books.value[0].id);
        }
      } catch (e) {
        showStatus('Failed to load books: ' + e.message, 'error');
      }
    }

    // Create book
    async function createBook() {
      if (!newBookTitle.value.trim()) return;
      try {
        const book = await apiPost('/api/books', { title: newBookTitle.value.trim() });
        books.value.unshift({ id: book.id, title: book.title, path: `books/${book.id}/`, updatedAt: book.updatedAt });
        await selectBook(book.id);
        showNewBookModal.value = false;
        newBookTitle.value = '';
        showStatus('Book created!', 'success');
      } catch (e) {
        showStatus('Failed to create book: ' + e.message, 'error');
      }
    }

    // Select book
    async function selectBook(bookId) {
      currentBookId.value = bookId;
      currentChapterId.value = null;
      editorContent.value = '';
      currentChapterTitle.value = '';
      previewHtml.value = '';

      try {
        bookMeta.value = await apiGet(`/api/books/${bookId}`);
        chapters.value = await apiGet(`/api/books/${bookId}/chapters`);

        // Initialize sortable for chapters
        nextTick(() => initSortable());

        // Auto-select first chapter
        if (chapters.value.length > 0) {
          await selectChapter(chapters.value[0].id);
        }
      } catch (e) {
        showStatus('Failed to load book: ' + e.message, 'error');
      }
    }

    // Switch book (from dropdown)
    async function switchBook() {
      await selectBook(currentBookId.value);
    }

    // Update book metadata
    async function updateMeta() {
      if (!currentBookId.value) return;
      try {
        await apiPut(`/api/books/${currentBookId.value}`, {
          title: bookMeta.value.title,
          author: bookMeta.value.author,
          cover: bookMeta.value.cover,
          language: bookMeta.value.language
        });
        // Update in books list
        const idx = books.value.findIndex(b => b.id === currentBookId.value);
        if (idx !== -1) {
          books.value[idx].title = bookMeta.value.title;
        }
      } catch (e) {
        showStatus('Failed to update metadata: ' + e.message, 'error');
      }
    }

    // Create chapter
    async function createChapter() {
      if (!currentBookId.value) return;
      try {
        const chapter = await apiPost(`/api/books/${currentBookId.value}/chapters`, {
          title: `Chapter ${chapters.value.length + 1}`,
          content: `# Chapter ${chapters.value.length + 1}\n\n`
        });
        chapters.value.push(chapter);
        await selectChapter(chapter.id);
        nextTick(() => initSortable());
        showStatus('Chapter created!', 'success');
      } catch (e) {
        showStatus('Failed to create chapter: ' + e.message, 'error');
      }
    }

    // Select chapter
    async function selectChapter(chapterId) {
      if (!currentBookId.value) return;
      currentChapterId.value = chapterId;

      try {
        const chapter = await apiGet(`/api/books/${currentBookId.value}/chapters/${chapterId}`);
        editorContent.value = chapter.content || '';
        currentChapterTitle.value = chapter.title || '';

        // Update preview
        previewHtml.value = renderMarkdown(editorContent.value);
      } catch (e) {
        showStatus('Failed to load chapter: ' + e.message, 'error');
      }
    }

    // Update chapter title
    async function updateChapterTitle() {
      if (!currentBookId.value || !currentChapterId.value) return;
      try {
        await apiPut(`/api/books/${currentBookId.value}/chapters/${currentChapterId.value}`, {
          title: currentChapterTitle.value
        });
        // Update in chapters list
        const idx = chapters.value.findIndex(c => c.id === currentChapterId.value);
        if (idx !== -1) {
          chapters.value[idx].title = currentChapterTitle.value;
        }
      } catch (e) {
        showStatus('Failed to update title: ' + e.message, 'error');
      }
    }

    // Delete chapter
    async function deleteChapter(chapterId) {
      if (!confirm('Delete this chapter?')) return;
      try {
        await apiDelete(`/api/books/${currentBookId.value}/chapters/${chapterId}`);
        chapters.value = chapters.value.filter(c => c.id !== chapterId);
        if (currentChapterId.value === chapterId) {
          currentChapterId.value = null;
          editorContent.value = '';
          currentChapterTitle.value = '';
          previewHtml.value = '';
          if (chapters.value.length > 0) {
            await selectChapter(chapters.value[0].id);
          }
        }
        showStatus('Chapter deleted', 'success');
      } catch (e) {
        showStatus('Failed to delete chapter: ' + e.message, 'error');
      }
    }

    // Editor input handler with auto-save
    function onEditorInput() {
      previewHtml.value = renderMarkdown(editorContent.value);

      // Sync scroll
      syncScroll();

      // Debounced auto-save
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveChapter, 2000);
    }

    // Save chapter
    async function saveChapter() {
      if (!currentBookId.value || !currentChapterId.value) return;
      try {
        await apiPut(`/api/books/${currentBookId.value}/chapters/${currentChapterId.value}`, {
          content: editorContent.value
        });
      } catch (e) {
        showStatus('Failed to save: ' + e.message, 'error');
      }
    }

    // Sync scroll between editor and preview
    function syncScroll() {
      if (!editor.value || !preview.value) return;
      const scrollRatio = editor.value.scrollTop / (editor.value.scrollHeight - editor.value.clientHeight);
      preview.value.scrollTop = scrollRatio * (preview.value.scrollHeight - preview.value.clientHeight);
    }

    // Paste handler for images
    function onPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            insertImage(file);
          }
          return;
        }
      }
    }

    // Insert image as base64 or upload
    async function insertImage(file) {
      // Convert to base64 for simplicity
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result;
        const imageMarkdown = `![${file.name}](${base64})`;
        insertTextAtCursor(imageMarkdown);
        onEditorInput();
      };
      reader.readAsDataURL(file);
    }

    // Upload image
    async function uploadImage(e) {
      const file = e.target.files?.[0];
      if (!file || !currentBookId.value) return;

      try {
        const result = await apiUpload(`/api/books/${currentBookId.value}/upload`, file);
        const imageMarkdown = `![${result.filename}](${result.url})`;
        insertTextAtCursor(imageMarkdown);
        onEditorInput();
        showStatus('Image uploaded!', 'success');
      } catch (e) {
        showStatus('Failed to upload image: ' + e.message, 'error');
      }

      // Reset input
      if (imageInput.value) imageInput.value.value = '';
    }

    // Upload cover
    async function uploadCover(e) {
      const file = e.target.files?.[0];
      if (!file || !currentBookId.value) return;

      try {
        const result = await apiUpload(`/api/books/${currentBookId.value}/upload`, file);
        bookMeta.value.cover = result.path;
        await updateMeta();
        showStatus('Cover uploaded!', 'success');
      } catch (e) {
        showStatus('Failed to upload cover: ' + e.message, 'error');
      }

      // Reset input
      if (coverInput.value) coverInput.value.value = '';
    }

    // Insert text at cursor position
    function insertTextAtCursor(text) {
      if (!editor.value) return;
      const start = editor.value.selectionStart;
      const end = editor.value.selectionEnd;
      editorContent.value = editorContent.value.substring(0, start) + text + editorContent.value.substring(end);

      // Move cursor after inserted text
      nextTick(() => {
        editor.value.selectionStart = editor.value.selectionEnd = start + text.length;
        editor.value.focus();
      });
    }

    // Export EPUB
    async function exportEpub() {
      if (!currentBookId.value) return;

      try {
        const response = await fetch(`/api/books/${currentBookId.value}/export`);
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bookMeta.value.title || 'book'}.epub`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('EPUB exported!', 'success');
      } catch (e) {
        showStatus('Export failed: ' + e.message, 'error');
      }
    }

    // Show book context menu
    function showBookMenu(e, book) {
      contextMenuX.value = e.clientX;
      contextMenuY.value = e.clientY;
      contextMenuBook.value = book;
      showContextMenu.value = true;
    }

    // Delete current book
    async function deleteCurrentBook() {
      if (!contextMenuBook.value) return;
      if (!confirm(`Delete book "${contextMenuBook.value.title}"? This cannot be undone.`)) return;

      try {
        await apiDelete(`/api/books/${contextMenuBook.value.id}`);
        books.value = books.value.filter(b => b.id !== contextMenuBook.value.id);

        if (currentBookId.value === contextMenuBook.value.id) {
          currentBookId.value = null;
          chapters.value = [];
          bookMeta.value = { id: '', title: '', author: '', cover: '', language: 'zh' };
          editorContent.value = '';
          currentChapterTitle.value = '';
          previewHtml.value = '';

          if (books.value.length > 0) {
            await selectBook(books.value[0].id);
          }
        }

        showContextMenu.value = false;
        showStatus('Book deleted', 'success');
      } catch (e) {
        showStatus('Failed to delete book: ' + e.message, 'error');
      }
    }

    // Initialize drag and drop for chapters
    function initSortable() {
      const el = document.getElementById('chapters-list');
      if (!el || !currentBookId.value) return;

      if (sortableInstance) {
        sortableInstance.destroy();
      }

      sortableInstance = new Sortable(el, {
        animation: 150,
        handle: '.drag-handle',
        onEnd: async (evt) => {
          if (!currentBookId.value) return;

          // Reorder chapters array
          const item = chapters.value.splice(evt.oldIndex, 1)[0];
          chapters.value.splice(evt.newIndex, 0, item);

          // Update order on server
          try {
            const orderedIds = chapters.value.map(c => c.id);
            await apiPut(`/api/books/${currentBookId.value}/chapters/reorder`, { orderedIds });
          } catch (e) {
            showStatus('Failed to reorder: ' + e.message, 'error');
            // Reload to restore original order
            chapters.value = await apiGet(`/api/books/${currentBookId.value}/chapters`);
          }
        }
      });
    }

    // Close context menu on click outside
    function handleClickOutside() {
      showContextMenu.value = false;
    }

    // Watch for modal open to focus input
    watch(showNewBookModal, (val) => {
      if (val) {
        nextTick(() => newBookInput.value?.focus());
      }
    });

    // Lifecycle
    onMounted(() => {
      loadBooks();
      document.addEventListener('click', handleClickOutside);
    });

    return {
      // State
      books,
      currentBookId,
      chapters,
      currentChapterId,
      editorContent,
      currentChapterTitle,
      bookMeta,
      previewHtml,
      showNewBookModal,
      newBookTitle,
      showContextMenu,
      contextMenuX,
      contextMenuY,
      statusMessage,
      statusType,
      // Refs
      newBookInput,
      editor,
      preview,
      coverInput,
      imageInput,
      // Methods
      createBook,
      selectBook,
      switchBook,
      updateMeta,
      createChapter,
      selectChapter,
      updateChapterTitle,
      deleteChapter,
      onEditorInput,
      onPaste,
      uploadImage,
      uploadCover,
      exportEpub,
      showBookMenu,
      deleteCurrentBook
    };
  }
}).mount('#app');
