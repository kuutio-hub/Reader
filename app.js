import { version } from './version.js';

const Epubly = {
    state: {
        book: null,
        rendition: null,
        isZenMode: false,
        currentBookId: null,
    },
    dom: {},

    reader: {
        init() { this.loadLastOpenedBook(); },
        async loadBook(bookData, bookId) {
            if (Epubly.state.book) {
                Epubly.tts.stop();
                Epubly.state.book.destroy();
            }
            Epubly.ui.showLoader('Könyv feldolgozása...');

            try {
                const settings = Epubly.settings.get();
                const isScrolled = settings.readingFlow === 'scrolled';

                Epubly.state.book = new window.ePub(bookData);
                Epubly.state.rendition = Epubly.state.book.renderTo("viewer", {
                    width: "100%", height: "100%",
                    flow: isScrolled ? "scrolled-doc" : "paginated",
                    spread: "auto"
                });

                document.getElementById('viewer').classList.toggle('scrolled', isScrolled);
                document.getElementById('prev').style.display = isScrolled ? 'none' : 'block';
                document.getElementById('next').style.display = isScrolled ? 'none' : 'block';

                const location = Epubly.storage.getLocation(bookId);
                await Epubly.state.rendition.display(location || undefined);

                Epubly.storage.saveLastOpenedBook(bookId);
                Epubly.state.currentBookId = bookId;

                await Epubly.state.book.ready;
                Epubly.toc.generate(Epubly.state.book.navigation.toc);
                this.applySettings(settings);

                Epubly.state.rendition.on("displayed", l => Epubly.toc.updateActive(l.start.href));
                Epubly.state.rendition.on("relocated", location => {
                    Epubly.storage.saveLocation(bookId, location.start.cfi);
                });

                Epubly.ui.hideLoader();
                Epubly.tts.init();
            } catch (error) {
                console.error("Error loading EPUB:", error);
                alert("Hiba a könyv betöltése közben.");
                Epubly.ui.hideLoader();
                Epubly.dom.ttsControls.style.display = 'none';
            }
        },
        async loadDefaultBook() {
            const defaultBookUrl = "https://s3.amazonaws.com/moby-dick/moby-dick.epub";
            const bookRecord = await Epubly.storage.db.getBook('default-moby-dick');
            if (bookRecord) {
                this.loadBook(bookRecord.data, 'default-moby-dick');
            } else {
                console.log("Loading default book for the first time...");
                Epubly.ui.showLoader('Alapértelmezett könyv letöltése...');
                const response = await fetch(defaultBookUrl);
                const arrayBuffer = await response.arrayBuffer();
                await Epubly.storage.importBook(arrayBuffer, 'default-moby-dick', true);
                this.loadBook(arrayBuffer, 'default-moby-dick');
            }
        },
        async loadLastOpenedBook() {
            const lastBookId = Epubly.storage.getLastOpenedBook();
            if (lastBookId) {
                const bookRecord = await Epubly.storage.db.getBook(lastBookId);
                if (bookRecord) {
                    this.loadBook(bookRecord.data, lastBookId);
                } else { this.loadDefaultBook(); }
            } else { this.loadDefaultBook(); }
        },
        nextPage() {
            Epubly.tts.stop();
            Epubly.state.rendition?.next();
        },
        prevPage() {
            Epubly.tts.stop();
            Epubly.state.rendition?.prev();
        },
        applySettings(settings) {
            if (!Epubly.state.rendition || !Epubly.state.book.isOpen) return;
            const themes = Epubly.state.rendition.themes;
            themes.fontSize(`${settings.fontSize}%`);
            themes.override("padding", `0 ${settings.margin}px`);
            themes.override("line-height", settings.lineHeight);
            themes.override("letter-spacing", `${settings.letterSpacing}px`);

            themes.register("custom", { "body": { "color": settings.textColor, "background-color": settings.bgColor } });
            themes.select("custom");
        }
    },

    toc: {
        generate(tocItems) {
            const tocList = Epubly.dom.tocList;
            tocList.innerHTML = '';
            if (!tocItems || tocItems.length === 0) {
                tocList.innerHTML = '<li>Nincs tartalomjegyzék.</li>';
                return;
            }
            const fragment = document.createDocumentFragment();
            tocItems.forEach(item => {
                const a = document.createElement('a');
                a.textContent = item.label.trim();
                a.href = item.href;
                a.addEventListener('click', (e) => { e.preventDefault(); Epubly.state.rendition.display(item.href); });
                const li = document.createElement('li');
                li.appendChild(a);
                fragment.appendChild(li);
            });
            tocList.appendChild(fragment);
        },
        updateActive(currentHref) {
            const links = Epubly.dom.tocList.querySelectorAll('a');
            links.forEach(link => {
                link.classList.toggle('active', link.getAttribute('href').split('#')[0] === currentHref.split('#')[0]);
            });
        }
    },

    library: {
        async render() {
            const grid = Epubly.dom.libraryGrid;
            grid.innerHTML = '<div class="spinner"></div>';
            const books = await Epubly.storage.db.getAllBooks();
            grid.innerHTML = '';

            if (books.length === 0) {
                grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center;">A könyvtárad üres.</p>`;
                return;
            }

            books.forEach(book => {
                const card = document.createElement('div');
                card.className = 'book-card';
                card.dataset.bookId = book.id;
                card.innerHTML = `
                    <div class="book-card-cover">
                        <img src="${book.metadata.coverUrl || ''}" alt="Borító" onerror="this.style.display='none'">
                    </div>
                    <div class="book-card-info">
                        <div class="book-card-title">${book.metadata.title}</div>
                        <div class="book-card-author">${book.metadata.creator}</div>
                    </div>
                    <button class="book-card-menu-btn" data-book-id="${book.id}">&#x22EE;</button>
                `;
                card.querySelector('.book-card-cover').addEventListener('click', () => {
                    Epubly.reader.loadBook(book.data, book.id);
                    Epubly.ui.showReaderView();
                });
                card.querySelector('.book-card-menu-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    Epubly.ui.showBookInfoModal(book);
                });
                grid.appendChild(card);
            });
        }
    },

    settings: {
        init() {
            this.load();
            Epubly.dom.fontSizeSlider.addEventListener('input', () => this.handleUpdate('fontSize', Epubly.dom.fontSizeSlider.value));
            Epubly.dom.marginSlider.addEventListener('input', () => this.handleUpdate('margin', Epubly.dom.marginSlider.value));
            Epubly.dom.lineHeightSlider.addEventListener('input', () => this.handleUpdate('lineHeight', Epubly.dom.lineHeightSlider.value));
            Epubly.dom.letterSpacingSlider.addEventListener('input', () => this.handleUpdate('letterSpacing', Epubly.dom.letterSpacingSlider.value));
            Epubly.dom.textColorPicker.addEventListener('input', () => this.handleUpdate('textColor', Epubly.dom.textColorPicker.value, true));
            Epubly.dom.bgColorPicker.addEventListener('input', () => this.handleUpdate('bgColor', Epubly.dom.bgColorPicker.value, true));

            document.querySelectorAll('.theme-btn').forEach(btn => {
                btn.addEventListener('click', () => this.applyThemePreset(btn.dataset.theme));
            });

            document.querySelectorAll('input[name="reading-mode"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.handleUpdate('readingFlow', e.target.value, false, true); // requires reload
                });
            });

            document.querySelectorAll('.settings-tab').forEach(tab => {
                tab.addEventListener('click', () => Epubly.ui.switchSettingsTab(tab.dataset.tab));
            });

            Epubly.dom.clearCacheBtn.addEventListener('click', Epubly.storage.clearAllBooks);
        },

        get() {
            const defaults = {
                fontSize: '100', margin: '40', lineHeight: '1.6', letterSpacing: '0',
                readingFlow: 'paginated', theme: 'oled',
                textColor: '#EDEDED', bgColor: '#000000'
            };
            const saved = JSON.parse(localStorage.getItem('epubly-settings')) || {};
            return { ...defaults, ...saved };
        },

        save(settings) {
            localStorage.setItem('epubly-settings', JSON.stringify(settings));
        },

        load() {
            const s = this.get();
            Epubly.dom.fontSizeSlider.value = s.fontSize;
            Epubly.dom.marginSlider.value = s.margin;
            Epubly.dom.lineHeightSlider.value = s.lineHeight;
            Epubly.dom.letterSpacingSlider.value = s.letterSpacing;
            Epubly.dom.textColorPicker.value = s.textColor;
            Epubly.dom.bgColorPicker.value = s.bgColor;
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            document.querySelector(`.theme-btn[data-theme="${s.theme}"]`)?.classList.add('active');
            document.querySelector(`input[name="reading-mode"][value="${s.readingFlow}"]`).checked = true;

            Epubly.reader.applySettings(s);
        },

        handleUpdate(key, value, isCustomTheme = false, requiresReload = false) {
            const s = this.get();
            s[key] = value;
            if (isCustomTheme) s.theme = 'custom';
            this.save(s);
            Epubly.reader.applySettings(s);
            if (!isCustomTheme) {
                document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            }
            if (requiresReload && Epubly.state.currentBookId) {
                Epubly.reader.loadLastOpenedBook();
            }
        },

        applyThemePreset(themeName) {
            const themes = {
                oled: { textColor: '#EDEDED', bgColor: '#000000' },
                sepia: { textColor: '#5b4636', bgColor: '#fbf0d9' },
                light: { textColor: '#111111', bgColor: '#ffffff' },
            };
            if (!themes[themeName]) return;

            const s = this.get();
            s.theme = themeName;
            s.textColor = themes[themeName].textColor;
            s.bgColor = themes[themeName].bgColor;
            this.save(s);

            Epubly.dom.textColorPicker.value = s.textColor;
            Epubly.dom.bgColorPicker.value = s.bgColor;
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            document.querySelector(`.theme-btn[data-theme="${themeName}"]`)?.classList.add('active');
            Epubly.reader.applySettings(s);
        }
    },

    storage: {
        db: {
            _db: null,
            async init() {
                return new Promise((resolve, reject) => {
                    if (this._db) return resolve(this._db);
                    const request = indexedDB.open('EpublyDB', 2);
                    request.onerror = e => reject("IndexedDB error: " + e.target.errorCode);
                    request.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
                    request.onupgradeneeded = e => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains('books')) {
                            db.createObjectStore('books', { keyPath: 'id' });
                        }
                    };
                });
            },
            async saveBook(bookRecord) {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(['books'], 'readwrite');
                    const store = tx.objectStore('books');
                    const req = store.put(bookRecord);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },
            async getBook(id) {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(['books'], 'readonly');
                    const store = tx.objectStore('books');
                    const req = store.get(id);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },
            async getAllBooks() {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(['books'], 'readonly');
                    const store = tx.objectStore('books');
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },
            async deleteBook(id) {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(['books'], 'readwrite');
                    const store = tx.objectStore('books');
                    const req = store.delete(id);
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            },
            async clearBooks() {
                const db = await this.init();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction(['books'], 'readwrite');
                    const store = tx.objectStore('books');
                    const req = store.clear();
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                });
            }
        },
        async importBook(arrayBuffer, bookId, isDefault = false) {
            try {
                Epubly.ui.showLoader('Metaadatok olvasása...');
                const tempBook = new window.ePub(arrayBuffer);
                const metadata = await tempBook.loaded.metadata;
                const coverUrl = await tempBook.coverUrl();
                let coverBlobUrl = null;
                if (coverUrl) {
                    const response = await fetch(coverUrl);
                    const blob = await response.blob();
                    coverBlobUrl = URL.createObjectURL(blob);
                }

                const finalId = isDefault ? bookId : `${metadata.title}-${Date.now()}`;
                const bookRecord = {
                    id: finalId, data: arrayBuffer,
                    metadata: {
                        title: metadata.title || 'Ismeretlen cím', creator: metadata.creator || 'Ismeretlen szerző',
                        publisher: metadata.publisher, pubdate: metadata.pubdate, coverUrl: coverBlobUrl
                    }
                };
                await this.db.saveBook(bookRecord);
                tempBook.destroy();
                console.log(`Book "${metadata.title}" saved.`);
                return bookRecord;
            } catch (err) {
                console.error("Error parsing EPUB for metadata:", err);
                alert("Hiba a könyv metaadatainak olvasása közben. A fájl valószínűleg sérült vagy nem támogatott formátumú.");
                return null;
            }
        },
        async handleFileUpload(file) {
            Epubly.ui.showLoader('Fájl olvasása...');
            const arrayBuffer = await file.arrayBuffer();
            const bookRecord = await this.importBook(arrayBuffer);
            if (bookRecord) {
                await Epubly.reader.loadBook(bookRecord.data, bookRecord.id);
                Epubly.ui.hideModal('import-modal');
                Epubly.ui.showReaderView();
            } else {
                Epubly.ui.hideLoader();
            }
        },
        saveLastOpenedBook(bookId) { if (bookId) localStorage.setItem('epubly-lastBookId', bookId); },
        getLastOpenedBook() { return localStorage.getItem('epubly-lastBookId'); },
        saveLocation(bookId, cfi) { if (bookId && cfi) localStorage.setItem(`epubly-location-${bookId}`, cfi); },
        getLocation(bookId) { return localStorage.getItem(`epubly-location-${bookId}`); },
        async clearAllBooks() {
            if (confirm("Biztosan törölni szeretnéd az összes könyvet? Ez a művelet nem vonható vissza.")) {
                await Epubly.storage.db.clearBooks();
                localStorage.removeItem('epubly-lastBookId');
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('epubly-location-')) {
                        localStorage.removeItem(key);
                    }
                });

                alert("Minden könyv törölve.");
                await Epubly.library.render();
                await Epubly.reader.loadDefaultBook();
            }
        }
    },

    search: {
        init() {
            Epubly.dom.searchBtn.addEventListener('click', () => this.performSearch());
            Epubly.dom.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.performSearch();
            });
        },
        async performSearch() {
            const query = Epubly.dom.searchInput.value.trim();
            if (query.length < 3) {
                alert("A kereséshez legalább 3 karakter szükséges.");
                return;
            }
            if (!Epubly.state.book) return;

            const list = Epubly.dom.searchResultsList;
            list.innerHTML = '<li><div class="spinner"></div><p>Keresés folyamatban...</p></li>';

            try {
                // epub.js search is intensive, so we do it chapter by chapter
                const searchPromises = Epubly.state.book.spine.sections.map(section => {
                    return section.load().then(() => {
                        const results = section.find(query);
                        section.unload(); // free memory
                        return results;
                    });
                });

                const results = await Promise.all(searchPromises);
                const flatResults = results.flat();
                this.renderResults(flatResults, query);
            } catch (error) {
                console.error("Search failed:", error);
                list.innerHTML = '<li>Hiba történt a keresés során.</li>';
            }
        },
        renderResults(results, query) {
            const list = Epubly.dom.searchResultsList;
            list.innerHTML = '';
            if (results.length === 0) {
                list.innerHTML = '<li>Nincs találat.</li>';
                return;
            }

            const fragment = document.createDocumentFragment();
            results.forEach(result => {
                const li = document.createElement('li');
                li.dataset.cfi = result.cfi;
                const excerpt = result.excerpt.replace(new RegExp(`(${query})`, 'gi'), '<strong>$1</strong>');
                li.innerHTML = `<div class="excerpt">${excerpt}</div>`;
                li.addEventListener('click', () => {
                    Epubly.state.rendition.display(result.cfi);
                    Epubly.ui.showReaderView();
                });
                fragment.appendChild(li);
            });
            list.appendChild(fragment);
        }
    },

    tts: {
        init() {
            if ('speechSynthesis' in window) {
                Epubly.dom.ttsControls.style.display = 'flex';
                Epubly.dom.ttsPlayBtn.addEventListener('click', () => this.play());
                Epubly.dom.ttsPauseBtn.addEventListener('click', () => this.pause());
                Epubly.dom.ttsStopBtn.addEventListener('click', () => this.stop());
            } else {
                console.warn("Text-to-Speech not supported in this browser.");
                Epubly.dom.ttsControls.style.display = 'none';
            }
        },
        async play() {
            if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
                this.updateUI('playing');
                return;
            }

            const contents = await Epubly.state.rendition.getContents();
            const text = contents[0].document.body.innerText;

            if (text) {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = Epubly.state.book.metadata.language || 'hu-HU';
                utterance.onend = () => { this.updateUI('stopped'); };
                window.speechSynthesis.cancel(); // Stop previous speech
                window.speechSynthesis.speak(utterance);
                this.updateUI('playing');
            }
        },
        pause() {
            window.speechSynthesis.pause();
            this.updateUI('paused');
        },
        stop() {
            window.speechSynthesis.cancel();
            this.updateUI('stopped');
        },
        updateUI(state) {
            Epubly.dom.ttsPlayBtn.style.display = (state === 'playing') ? 'none' : 'flex';
            Epubly.dom.ttsPauseBtn.style.display = (state === 'playing') ? 'flex' : 'none';
            Epubly.dom.ttsStopBtn.style.display = (state === 'playing' || state === 'paused') ? 'flex' : 'none';
        }
    },

    ui: {
        init() {
            const ids = ['topbar', 'sidebar-left', 'sidebar-right', 'main-content', 'viewer', 'prev', 'next', 'loader', 'toc-list', 'zen-mode-btn', 'import-modal', 'settings-modal', 'epub-file', 'font-size-slider', 'margin-slider', 'import-book-sidebar-btn', 'library-grid', 'line-height-slider', 'letter-spacing-slider', 'text-color-picker', 'bg-color-picker', 'clear-cache-btn', 'book-info-modal', 'delete-book-btn', 'book-info-meta', 'book-info-cover', 'search-input', 'search-btn', 'search-results-list', 'tts-controls', 'tts-play-btn', 'tts-pause-btn', 'tts-stop-btn', 'app-footer', 'footer-year', 'footer-version'];
            ids.forEach(id => Epubly.dom[id.replace(/-(\w)/g, (m, g) => g.toUpperCase())] = document.getElementById(id));
            Epubly.dom.navLinks = document.querySelectorAll('.nav-link');
            Epubly.dom.modalCloseBtns = document.querySelectorAll('.modal-close-btn');
            this.attachEventListeners();
            this.setFooter();
        },
        attachEventListeners() {
            Epubly.dom.prev.addEventListener('click', () => Epubly.reader.prevPage());
            Epubly.dom.next.addEventListener('click', () => Epubly.reader.nextPage());
            document.addEventListener('keydown', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.key === 'ArrowLeft') Epubly.reader.prevPage();
                if (e.key === 'ArrowRight') Epubly.reader.nextPage();
            });
            Epubly.dom.zenModeBtn.addEventListener('click', this.toggleZenMode);
            Epubly.dom.navLinks.forEach(link => link.addEventListener('click', e => { e.preventDefault(); this.handleNavClick(e.currentTarget); }));
            Epubly.dom.modalCloseBtns.forEach(btn => btn.addEventListener('click', () => this.hideModal(btn.dataset.target)));
            Epubly.dom.epubFile.addEventListener('change', e => { if (e.target.files[0]) Epubly.storage.handleFileUpload(e.target.files[0]); });
            Epubly.dom.importBookSidebarBtn.addEventListener('click', () => this.showModal('import-modal'));
        },
        toggleZenMode() { Epubly.state.isZenMode = !Epubly.state.isZenMode; document.body.classList.toggle('zen-mode', Epubly.state.isZenMode); },
        handleNavClick(target) {
            const targetId = target.dataset.target;
            Epubly.dom.navLinks.forEach(l => l.classList.remove('active'));
            target.classList.add('active');
            if (targetId === 'reader') { this.showReaderView(); }
            else if (targetId === 'library') { this.showLibraryView(); }
            else if (targetId === 'search') { this.showSearchView(); }
            else if (targetId === 'settings') { this.showModal('settings-modal'); }
        },
        showReaderView() {
            this.showSidebarPanel('toc');
            Epubly.dom.sidebarRight.classList.remove('visible');
            Epubly.dom.navLinks.forEach(l => l.classList.remove('active'));
            document.querySelector('.nav-link[data-target="reader"]').classList.add('active');
        },
        showLibraryView() {
            this.showSidebarPanel('library-sidebar');
            Epubly.library.render();
            Epubly.dom.sidebarRight.classList.remove('visible');
        },
        showSearchView() {
            this.showSidebarPanel('search');
            Epubly.dom.searchInput.focus();
            Epubly.dom.sidebarRight.classList.remove('visible');
        },
        showSidebarPanel(panelId) {
            document.querySelectorAll('#sidebar-left .sidebar-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`panel-${panelId}`).classList.add('active');
        },
        showModal(id) { document.getElementById(id).classList.add('visible'); },
        hideModal(id) { document.getElementById(id).classList.remove('visible'); },
        showLoader(msg) { Epubly.dom.loader.classList.remove('hidden'); Epubly.dom.loader.querySelector('p').textContent = msg; },
        hideLoader() { Epubly.dom.loader.classList.add('hidden'); },
        switchSettingsTab(tabId) {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelector(`.settings-tab[data-tab="${tabId}"]`).classList.add('active');
            document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`settings-panel-${tabId}`).classList.add('active');
        },
        showBookInfoModal(book) {
            Epubly.dom.bookInfoCover.src = book.metadata.coverUrl || '';
            Epubly.dom.bookInfoCover.style.display = book.metadata.coverUrl ? 'block' : 'none';
            Epubly.dom.bookInfoMeta.innerHTML = `
                <p><strong>Cím:</strong> ${book.metadata.title}</p>
                <p><strong>Szerző:</strong> ${book.metadata.creator}</p>
                <p><strong>Kiadó:</strong> ${book.metadata.publisher || 'N/A'}</p>
                <p><strong>Dátum:</strong> ${book.metadata.pubdate || 'N/A'}</p>
            `;
            Epubly.dom.deleteBookBtn.onclick = async () => {
                if (confirm(`Biztosan törlöd a "${book.metadata.title}" című könyvet?`)) {
                    await Epubly.storage.db.deleteBook(book.id);
                    if (book.metadata.coverUrl && book.metadata.coverUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(book.metadata.coverUrl);
                    }
                    this.hideModal('book-info-modal');
                    await Epubly.library.render();
                    if (Epubly.state.currentBookId === book.id) {
                        await Epubly.reader.loadDefaultBook();
                    }
                }
            };
            this.showModal('book-info-modal');
        },
        setFooter() {
            Epubly.dom.footerYear.textContent = new Date().getFullYear();
            Epubly.dom.footerVersion.textContent = version;
        }
    },

    init() {
        this.ui.init();
        this.storage.db.init().then(() => {
            this.reader.init();
            this.settings.init();
            this.search.init();
            console.log(`Epubly Initialized. Version: ${version}`);
        });
    }
};

function attemptInit() {
    if (window.ePub) {
        Epubly.init();
    } else {
        setTimeout(attemptInit, 50);
    }
}
attemptInit();
