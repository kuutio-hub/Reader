import { version } from './version.js';

const Epubly = {
    state: {
        book: null,
        rendition: null,
        isZenMode: false,
        currentBookId: null,
        activeBookSessionStart: null,
    },
    dom: {},

    reader: {
        async loadBook(bookData, bookId) {
            // Save stats for previous book if exists
            if (Epubly.state.book && Epubly.state.currentBookId) {
                this.updateSessionStats();
                try { Epubly.state.book.destroy(); } catch(e) {}
            }
            
            // Clean DOM
            const viewer = document.getElementById('viewer');
            viewer.innerHTML = '';
            
            // Reset state
            Epubly.state.book = null;
            Epubly.state.rendition = null;
            Epubly.state.currentBookId = null;
            Epubly.state.activeBookSessionStart = null;

            if(!bookData) return; // Just unloading

            try {
                // IMPORTANT: Show reader view FIRST to ensure container has dimensions
                Epubly.ui.showReaderView(false); 

                const settings = Epubly.settings.get();
                // FORCE SCROLLED MODE FOR PERFORMANCE BY DEFAULT
                const isScrolled = settings.readingFlow !== 'paginated'; // Default is scrolled now

                // Ensure ePub is available
                if (!window.ePub) throw new Error("Az ePub.js könyvtár nem töltődött be. Ellenőrizd az internetkapcsolatot.");

                // Initialize book
                Epubly.state.book = window.ePub(bookData);
                await Epubly.state.book.ready; // Wait for parsing to finish

                // Get metadata safely
                let metaTitle = "Névtelen Könyv";
                try {
                    if(Epubly.state.book.package && Epubly.state.book.package.metadata) {
                        metaTitle = Epubly.state.book.package.metadata.title;
                    }
                } catch(e) {}
                Epubly.ui.updateHeaderTitle(metaTitle);

                // --- PERFORMANCE CONFIGURATION ---
                // We use 'continuous' manager for instant scrolling (like FlowReader)
                // We use 'scrolled' flow to avoid expensive page calculations
                Epubly.state.rendition = Epubly.state.book.renderTo("viewer", {
                    manager: "continuous", // Optimized for scrolling
                    flow: "scrolled",      // No pagination calculation = 10x speed
                    width: "100%", 
                    height: "100%",
                    snap: false
                });

                // Update UI class for scrolling
                viewer.classList.add('scrolled'); // Always force scrolled class structure for now
                
                // Hide nav zones if scrolled
                const navZones = document.querySelectorAll('.nav-zone');
                navZones.forEach(nz => nz.style.display = 'none'); // Disable click zones in scroll mode

                // Restore location
                const location = Epubly.storage.getLocation(bookId);
                
                // Display!
                await Epubly.state.rendition.display(location || undefined);

                // Setup session tracking
                Epubly.state.currentBookId = bookId;
                Epubly.state.activeBookSessionStart = Date.now();
                Epubly.storage.saveLastOpenedBook(bookId);
                
                // Load TOC (safely)
                try {
                    const navigation = await Epubly.state.book.loaded.navigation;
                    Epubly.toc.generate(navigation.toc);
                } catch(e) { console.warn("TOC load failed", e); }

                this.applySettings(settings);

                // Events
                Epubly.state.rendition.on("displayed", l => {
                    Epubly.ui.hideLoader(); // Hide loader immediately after first render
                    // Epubly.toc.updateActive(l.start.href); // Can be expensive in continuous mode, opt-in
                });
                
                // Track progress and time on relocation
                Epubly.state.rendition.on("relocated", location => {
                    Epubly.storage.saveLocation(bookId, location.start.cfi);
                    this.updateSessionStats(location);
                    // Update active TOC item loosely
                    if(location.start.href) Epubly.toc.updateActive(location.start.href);
                });

            } catch (error) {
                console.error("Error loading EPUB:", error);
                Epubly.ui.hideLoader();
                alert("Hiba a könyv megnyitása közben: " + error.message);
                Epubly.ui.showLibraryView();
            }
        },
        updateSessionStats(location) {
            if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
            
            const now = Date.now();
            const duration = now - Epubly.state.activeBookSessionStart;
            // Update start time to now to avoid double counting if called multiple times
            Epubly.state.activeBookSessionStart = now;

            // Calculate percentage if location provided
            let percentage = null;
            if(location && location.start && typeof location.start.percentage === 'number') {
                percentage = location.start.percentage;
            }

            Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, percentage);
        },
        nextPage() {
            // In continuous/scrolled mode, we scroll instead of paging
            const viewer = document.getElementById('viewer');
            if(viewer) viewer.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        },
        prevPage() {
            const viewer = document.getElementById('viewer');
            if(viewer) viewer.scrollBy({ top: -(window.innerHeight * 0.8), behavior: 'smooth' });
        },
        applySettings(settings) {
            if (!Epubly.state.rendition) return;
            
            // Apply themes.default
            const rules = {
                'body': { 
                    'color': `${settings.textColor} !important`, 
                    'background': `${settings.bgColor} !important`,
                    'font-family': `${settings.fontFamily} !important`,
                    'font-size': `${settings.fontSize}% !important`,
                    'line-height': `${settings.lineHeight} !important`,
                    'padding': `0 ${settings.margin}% !important`, // Horizontal margin
                    'padding-top': '20px !important',
                    'padding-bottom': '20px !important',
                    'max-width': '900px !important', // Optimize reading width
                    'margin': '0 auto !important'
                },
                'p': {
                    'font-family': `${settings.fontFamily} !important`,
                    'font-size': '1em !important',
                    'line-height': `${settings.lineHeight} !important`,
                    'text-align': `${settings.textAlign} !important`,
                    'color': `${settings.textColor} !important`
                },
                'a': {
                    'color': `${settings.textColor} !important`
                },
                'img': {
                    'max-width': '100% !important',
                    'height': 'auto !important'
                }
            };

            Epubly.state.rendition.themes.default(rules);

            // Global background
            document.getElementById('reader-main').style.backgroundColor = settings.bgColor;
            
            // Pattern
            const overlay = document.getElementById('pattern-overlay');
            if (settings.pattern === 'paper') {
                overlay.style.backgroundImage = 'radial-gradient(#000 1px, transparent 0)';
                overlay.style.backgroundSize = '20px 20px';
                overlay.style.opacity = '0.1';
            } else if (settings.pattern === 'lines') {
                overlay.style.backgroundImage = 'repeating-linear-gradient(0deg, transparent, transparent 19px, #000 20px)';
                overlay.style.backgroundSize = '100% 20px';
                overlay.style.opacity = '0.05';
            } else if (settings.pattern === 'noise') {
                 overlay.style.backgroundImage = 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22 opacity=%221%22/%3E%3C/svg%3E")';
                 overlay.style.opacity = '0.15';
            } else {
                overlay.style.backgroundImage = 'none';
            }
        }
    },

    toc: {
        generate(tocItems) {
            const tocList = document.getElementById('toc-list');
            if(!tocList) return;
            tocList.innerHTML = '';
            if (!tocItems || tocItems.length === 0) {
                tocList.innerHTML = '<li><span style="color:var(--text-muted); padding:8px; display:block;">Nincs tartalomjegyzék.</span></li>';
                return;
            }
            const fragment = document.createDocumentFragment();
            
            const createLink = (item) => {
                const a = document.createElement('a');
                a.textContent = item.label ? item.label.trim() : "Névtelen fejezet";
                a.href = item.href;
                a.style.display = "block";
                a.style.padding = "8px";
                a.style.color = "var(--text-muted)";
                a.style.textDecoration = "none";
                a.style.cursor = "pointer";
                a.style.borderRadius = "4px";

                a.addEventListener('mouseenter', () => { a.style.color = "var(--text)"; a.style.backgroundColor = "var(--surface-alt)"; });
                a.addEventListener('mouseleave', () => { 
                    if(!a.classList.contains('active')) {
                        a.style.color = "var(--text-muted)"; a.style.backgroundColor = "transparent"; 
                    }
                });
                
                a.addEventListener('click', (e) => { 
                    e.preventDefault(); 
                    Epubly.state.rendition.display(item.href); 
                    if(window.innerWidth < 800) {
                        document.getElementById('reader-sidebar-left').classList.remove('visible');
                    }
                });
                return a;
            };

            tocItems.forEach(item => {
                const li = document.createElement('li');
                li.appendChild(createLink(item));
                fragment.appendChild(li);
            });
            tocList.appendChild(fragment);
        },
        updateActive(currentHref) {
            // Simplified loose matching for performance
            const tocList = document.getElementById('toc-list');
            if(!tocList) return;
            const links = tocList.querySelectorAll('a');
            let found = false;
            
            // Only update if not already active to save DOM ops
            links.forEach(link => {
                const linkHref = link.getAttribute('href');
                if(!linkHref) return;
                
                const cleanCurrent = currentHref.split('#')[0];
                const cleanLink = linkHref.split('#')[0];

                const isActive = cleanCurrent === cleanLink;
                
                if (isActive) {
                    if(!link.classList.contains('active')) {
                        // Clear old active
                        const old = tocList.querySelector('.active');
                        if(old) {
                            old.classList.remove('active');
                            old.style.color = "var(--text-muted)";
                            old.style.fontWeight = "normal";
                        }
                        
                        link.classList.add('active');
                        link.style.color = "var(--brand)";
                        link.style.fontWeight = "bold";
                        link.scrollIntoView({block: "center", behavior: "smooth"});
                    }
                    found = true;
                }
            });
        }
    },

    library: {
        async render() {
            const grid = document.getElementById('library-grid');
            if(!grid) return;
            
            try {
                const books = await Epubly.storage.db.getAllBooks();
                grid.innerHTML = '';

                if (!books || books.length === 0) {
                    grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center; margin-top: 40px;">A könyvtárad üres.<br>Kattints az "Importálás" gombra!</p>`;
                    return;
                }

                books.forEach(book => {
                    const card = document.createElement('div');
                    card.className = 'book-card';
                    // Cover fallback
                    const coverSrc = book.metadata.coverUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150" viewBox="0 0 100 150"><rect width="100" height="150" fill="%23222"/><text x="50" y="75" fill="%23555" font-family="sans-serif" font-size="12" text-anchor="middle">Nincs borító</text></svg>';
                    
                    const safeTitle = book.metadata.title || "Ismeretlen cím";
                    const safeCreator = book.metadata.creator || "Ismeretlen szerző";

                    card.innerHTML = `
                        <div class="book-cover">
                            <img src="${coverSrc}" alt="${safeTitle}" loading="lazy">
                        </div>
                        <div class="book-title" title="${safeTitle}">${safeTitle}</div>
                        <div class="book-author" title="${safeCreator}">${safeCreator}</div>
                    `;
                    card.onclick = () => Epubly.ui.showBookInfoModal(book);
                    grid.appendChild(card);
                });
            } catch (e) {
                console.error("Library render error:", e);
                grid.innerHTML = `<p style="color: var(--danger);">Hiba a könyvtár betöltésekor. (${e.message})</p>`;
            }
        }
    },

    settings: {
        init() {
            this.load();
            
            const bindInput = (id, key) => {
                const el = document.getElementById(id);
                if(el) el.addEventListener('input', (e) => this.handleUpdate(key, e.target.value));
            }

            bindInput('font-size-range', 'fontSize');
            bindInput('line-height-range', 'lineHeight');
            bindInput('letter-spacing-range', 'letterSpacing');
            bindInput('margin-range', 'margin');
            bindInput('bg-color-picker', 'bgColor');
            bindInput('text-color-picker', 'textColor');
            
            const bindToggleGroup = (groupId, key, needsReload) => {
                const group = document.getElementById(groupId);
                if(!group) return;
                group.querySelectorAll('.toggle-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        this.handleUpdate(key, btn.dataset.val, false, needsReload);
                    });
                });
            }

            // Note: 'readingFlow' is now essentially ignored or forced to scrolled in code, but UI preserved
            bindToggleGroup('layout-toggle-group', 'readingFlow', true);
            bindToggleGroup('align-toggle-group', 'textAlign');
            bindToggleGroup('theme-toggle-group', 'theme');
            
            const fontSelect = document.getElementById('font-family-select');
            if(fontSelect) fontSelect.addEventListener('change', (e) => this.handleUpdate('fontFamily', e.target.value));

            const patternSelect = document.getElementById('pattern-select');
            if(patternSelect) patternSelect.addEventListener('change', (e) => this.handleUpdate('pattern', e.target.value));

            const clearBtn = document.getElementById('btn-clear-cache');
            if(clearBtn) clearBtn.addEventListener('click', Epubly.storage.clearAllBooks);
        },

        get() {
            const defaults = {
                fontSize: '100', lineHeight: '1.6', letterSpacing: '0', margin: '15', // Increased default margin for scrolling
                readingFlow: 'scrolled', theme: 'oled',
                textAlign: 'left', fontFamily: "'Inter', sans-serif",
                textColor: '#EDEDED', bgColor: '#000000', pattern: 'none'
            };
            const saved = JSON.parse(localStorage.getItem('epubly-settings')) || {};
            return { ...defaults, ...saved };
        },

        save(settings) {
            localStorage.setItem('epubly-settings', JSON.stringify(settings));
        },

        load() {
            const s = this.get();
            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
            setVal('font-size-range', s.fontSize);
            setVal('line-height-range', s.lineHeight);
            setVal('letter-spacing-range', s.letterSpacing);
            setVal('margin-range', s.margin);
            setVal('text-color-picker', s.textColor);
            setVal('bg-color-picker', s.bgColor);
            setVal('font-family-select', s.fontFamily);
            setVal('pattern-select', s.pattern);

            // Update toggle buttons active state
            const updateToggle = (groupId, val) => {
                const g = document.getElementById(groupId);
                if(g) {
                    g.querySelectorAll('.toggle-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.val === val);
                    });
                }
            };
            updateToggle('layout-toggle-group', s.readingFlow);
            updateToggle('align-toggle-group', s.textAlign);
            updateToggle('theme-toggle-group', s.theme);

            Epubly.reader.applySettings(s);
        },

        handleUpdate(key, value, isCustomTheme = false, requiresReload = false) {
            const s = this.get();
            
            // Special case for presets
            if(key === 'theme') {
                const presets = {
                    oled: { textColor: '#EDEDED', bgColor: '#000000' },
                    sepia: { textColor: '#5b4636', bgColor: '#fbf0d9' },
                    light: { textColor: '#111111', bgColor: '#ffffff' },
                };
                if(presets[value]) {
                    s.textColor = presets[value].textColor;
                    s.bgColor = presets[value].bgColor;
                    // Update pickers
                    const tcp = document.getElementById('text-color-picker'); if(tcp) tcp.value = s.textColor;
                    const bcp = document.getElementById('bg-color-picker'); if(bcp) bcp.value = s.bgColor;
                }
            }
            
            s[key] = value;
            this.save(s);
            this.load(); // Refresh UI states

            if (requiresReload && Epubly.state.currentBookId) {
                // In continuous mode, full reload is rarely needed for style changes, 
                // but if we switch flow (which we disabled for now), we would need it.
                // Re-applying settings is usually enough.
                Epubly.reader.applySettings(s);
            } else {
                Epubly.reader.applySettings(s);
            }
        }
    },

    storage: {
        db: {
            _db: null,
            async init() {
                return new Promise((resolve, reject) => {
                    if (this._db) return resolve(this._db);
                    // Keep version 4 to maintain data
                    const request = indexedDB.open('EpublyDB', 4);
                    request.onerror = e => reject("IndexedDB error: " + e.target.error);
                    request.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
                    request.onupgradeneeded = e => {
                        const db = e.target.result;
                        if (db.objectStoreNames.contains('books')) {
                            db.deleteObjectStore('books');
                        }
                        db.createObjectStore('books', { keyPath: 'id' });
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
        async getCoverBase64(coverUrl) {
            if(!coverUrl) return null;
            try {
                const response = await fetch(coverUrl);
                const blob = await response.blob();
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } catch(e) {
                console.warn("Cover fetch failed", e);
                return null;
            }
        },
        // *** COMPLETELY REWRITTEN IMPORT FUNCTION ***
        async importBook(arrayBuffer, bookId, isDefault = false) {
            let tempBook = null;
            try {
                if (!window.ePub) throw new Error("Az ePub.js könyvtár nincs betöltve.");
                
                // Initialize book with the buffer
                tempBook = window.ePub(arrayBuffer);
                
                // Wait for the book to be ready (parsing spine, container, etc)
                await tempBook.ready;

                // Robust Metadata Extraction
                let rawMetadata = {};
                try {
                    // Try the standard way first (modern epub.js)
                    rawMetadata = await tempBook.loaded.metadata; 
                } catch (metaError) {
                    console.warn("Metadata promise failed, trying fallback...", metaError);
                    // Fallback to internal properties if promise fails
                    if(tempBook.package && tempBook.package.metadata) {
                        rawMetadata = tempBook.package.metadata;
                    }
                }

                // Normalize metadata to ensure no 'undefined' errors
                const safeMeta = rawMetadata || {};

                const finalMetadata = {
                    title: safeMeta.title || 'Névtelen Könyv',
                    creator: safeMeta.creator || 'Ismeretlen Szerző',
                    publisher: safeMeta.publisher || '',
                    pubdate: safeMeta.pubdate || '',
                    description: safeMeta.description || 'Nincs leírás.',
                    coverUrl: null
                };

                // Cover Extraction
                try {
                    const coverUrl = await tempBook.coverUrl();
                    if(coverUrl) {
                        finalMetadata.coverUrl = await this.getCoverBase64(coverUrl);
                    }
                } catch (coverErr) {
                    console.warn("No cover found or extraction failed:", coverErr);
                }

                // ID Generation
                const finalId = isDefault ? bookId : `${Date.now()}`;
                
                // Construct Record
                const bookRecord = {
                    id: finalId, 
                    data: arrayBuffer,
                    metadata: finalMetadata,
                    stats: {
                        totalTime: 0,
                        progress: 0,
                        lastRead: Date.now()
                    }
                };
                
                // Persist
                await this.db.saveBook(bookRecord);
                return bookRecord;

            } catch (err) {
                console.error("Critical Import Error:", err);
                throw new Error("Sikertelen importálás: " + (err.message || "Ismeretlen hiba"));
            } finally {
                // Always clean up resources
                if (tempBook) {
                    try { tempBook.destroy(); } catch(e) {}
                }
            }
        },
        async handleFileUpload(file) {
            Epubly.ui.showLoader('Feldolgozás...');
            Epubly.ui.hideModal('import-modal');
            
            try {
                const arrayBuffer = await file.arrayBuffer();
                await this.importBook(arrayBuffer);
                
                // Allow DB to settle
                setTimeout(async () => {
                    await Epubly.library.render();
                    Epubly.ui.hideLoader();
                }, 200);
            } catch (error) {
                alert(error.message);
                Epubly.ui.hideLoader();
            }
        },
        async updateBookStats(bookId, durationDelta, percentage) {
            try {
                const book = await this.db.getBook(bookId);
                if(book) {
                    // Ensure stats object exists
                    if(!book.stats) book.stats = { totalTime: 0, progress: 0, lastRead: Date.now() };
                    
                    // Sanity check delta (e.g., max 24 hours to prevent glitches)
                    if(durationDelta > 0 && durationDelta < 86400000) { 
                        book.stats.totalTime += durationDelta;
                    }
                    
                    if(percentage !== null && percentage !== undefined && !isNaN(percentage)) {
                        book.stats.progress = percentage;
                    }
                    
                    book.stats.lastRead = Date.now();
                    await this.db.saveBook(book);
                }
            } catch(e) { console.warn("Stats update failed", e); }
        },
        saveLastOpenedBook(bookId) { if (bookId) localStorage.setItem('epubly-lastBookId', bookId); },
        getLastOpenedBook() { return localStorage.getItem('epubly-lastBookId'); },
        saveLocation(bookId, cfi) { if (bookId && cfi) localStorage.setItem(`epubly-location-${bookId}`, cfi); },
        getLocation(bookId) { return localStorage.getItem(`epubly-location-${bookId}`); },
        async clearAllBooks() {
            if (confirm("Biztosan törölni szeretnéd az összes könyvet?")) {
                await Epubly.storage.db.clearBooks();
                localStorage.removeItem('epubly-lastBookId');
                location.reload();
            }
        }
    },

    ui: {
        init() {
            // Bind Nav Clicks (These now just scroll up/down in continuous mode)
            document.getElementById('nav-prev').addEventListener('click', () => Epubly.reader.prevPage());
            document.getElementById('nav-next').addEventListener('click', () => Epubly.reader.nextPage());
            
            // Sidebar Close
            document.getElementById('btn-close-sidebar').addEventListener('click', () => {
                document.getElementById('reader-sidebar-left').classList.remove('visible');
            });

            // Brand Logo Navigation - Returns to Library
            document.getElementById('app-logo-btn').addEventListener('click', () => {
                // If currently reading, update stats before closing
                if(Epubly.state.book && Epubly.state.currentBookId) {
                    Epubly.reader.updateSessionStats();
                    Epubly.reader.loadBook(null); // Unload/Destroy current
                }
                Epubly.ui.showLibraryView();
            });

            // Import Drop Zone & File Input
            const fileInput = document.getElementById('epub-file');
            const dropZone = document.getElementById('import-drop-zone');
            
            if(fileInput && dropZone) {
                // Standard file input change
                fileInput.addEventListener('change', (e) => {
                    if(e.target.files.length > 0) {
                        Epubly.storage.handleFileUpload(e.target.files[0]);
                        e.target.value = '';
                    }
                });

                // Drag & Drop Events
                dropZone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.add('hover');
                });
                
                dropZone.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.remove('hover');
                });

                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.remove('hover');
                    
                    if (e.dataTransfer.files.length > 0) {
                        const file = e.dataTransfer.files[0];
                        if (file.name.toLowerCase().endsWith('.epub')) {
                            Epubly.storage.handleFileUpload(file);
                        } else {
                            alert("Csak .epub kiterjesztésű fájlokat importálhatsz!");
                        }
                    }
                });
            }

            // Modal Close Buttons
            document.querySelectorAll('.modal-close').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.target.closest('.modal').classList.remove('visible');
                });
            });

            // Modal Click Outside to Close
            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => {
                    if(e.target === modal) {
                        modal.classList.remove('visible');
                    }
                });
            });

            // Keyboard Navigation
            document.addEventListener('keydown', e => {
                if(Epubly.state.currentBookId && document.getElementById('reader-view').classList.contains('active')) {
                     if (e.key === 'ArrowLeft') Epubly.reader.prevPage();
                     if (e.key === 'ArrowRight') Epubly.reader.nextPage();
                }
            });
        },
        showModal(id) { document.getElementById(id).classList.add('visible'); },
        hideModal(id) { document.getElementById(id).classList.remove('visible'); },
        showLoader(msg) { 
            const l = document.getElementById('loader');
            l.classList.remove('hidden');
            if(msg) document.getElementById('loader-msg').textContent = msg;
            document.getElementById('loader-error').style.display = 'none';
            document.getElementById('retry-btn').style.display = 'none';
        },
        hideLoader() { document.getElementById('loader').classList.add('hidden'); },
        
        updateHeaderTitle(title) {
            document.getElementById('header-title-text').textContent = title;
        },

        showReaderView(updateTitle = true) {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('reader-view').classList.add('active');
            
            // Reader Header Actions
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <button class="btn btn-secondary" onclick="Epubly.reader.updateSessionStats(); Epubly.reader.loadBook(null); Epubly.ui.showLibraryView()">Vissza</button>
                <button class="icon-btn" onclick="document.getElementById('reader-sidebar-left').classList.add('visible')" title="Tartalomjegyzék">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                <button class="icon-btn" onclick="Epubly.ui.showModal('settings-modal')" title="Beállítások">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            `;
            if(updateTitle) {
                const metaTitle = Epubly.state.book && Epubly.state.book.package ? Epubly.state.book.package.metadata.title : 'Olvasó';
                this.updateHeaderTitle(metaTitle);
            }
        },
        showLibraryView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('library-view').classList.add('active');
            
            this.updateHeaderTitle('Könyvtár');
            
            // Library Header Actions
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <button class="btn btn-primary" onclick="Epubly.ui.showModal('import-modal')">Importálás</button>
                <button class="icon-btn" onclick="Epubly.ui.showModal('settings-modal')" title="Beállítások">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            `;

            Epubly.library.render();
        },
        showBookInfoModal(book) {
            document.getElementById('detail-cover-img').src = book.metadata.coverUrl || '';
            document.getElementById('detail-title').textContent = book.metadata.title;
            document.getElementById('detail-author').textContent = book.metadata.creator;
            document.getElementById('detail-desc').innerHTML = book.metadata.description || 'Nincs leírás.';
            
            // Stats calculation
            const stats = book.stats || { totalTime: 0, progress: 0 };
            const minutes = Math.floor(stats.totalTime / 1000 / 60);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            const timeStr = hours > 0 ? `${hours}ó ${mins}p` : `${mins}p`;
            
            const progressVal = Math.round((stats.progress || 0) * 100);
            
            document.getElementById('detail-stats-time').textContent = timeStr;
            document.getElementById('detail-stats-prog').textContent = `${progressVal}%`;

            document.getElementById('btn-read-book').onclick = async () => {
                this.hideModal('book-details-modal');
                this.showLoader('Könyv megnyitása...');
                try {
                    await Epubly.reader.loadBook(book.data, book.id);
                    // showReaderView is called inside loadBook to ensure timing
                } catch(e) { 
                    alert(e.message); 
                    this.hideLoader();
                } 
            };

            document.getElementById('btn-delete-book').onclick = async () => {
                if(confirm('Biztosan törölni szeretnéd ezt a könyvet?')) {
                    await Epubly.storage.db.deleteBook(book.id);
                    this.hideModal('book-details-modal');
                    Epubly.library.render();
                }
            };

            this.showModal('book-details-modal');
        }
    },
    
    async init() {
        try {
            document.getElementById('version-display').textContent = version;
            document.getElementById('year-display').textContent = new Date().getFullYear();
            
            this.ui.init();
            this.settings.init();
            await this.storage.db.init();
            
            // Explicitly show library view to render header buttons on startup
            this.ui.showLibraryView();
            
            // Small delay to ensure UI updates
            setTimeout(() => {
                this.ui.hideLoader();
            }, 100);
            
            console.log(`Epubly v${version} Initialized.`);
        } catch (error) {
            console.error("Fatal init error:", error);
            this.ui.showLoader("Hiba történt!");
            document.getElementById('loader-error').textContent = error.message;
            document.getElementById('loader-error').style.display = 'block';
        }
    }
};

window.Epubly = Epubly;

/**
 * BOOTSTRAP LOADER
 * Simplified to rely on HTML script tags first.
 */
const DependencyLoader = {
    async boot() {
        // Simple message
        document.getElementById('loader-msg').textContent = "Inicializálás...";
        
        // 1. Check if libraries are already present (loaded via HTML script tags)
        if (window.JSZip && window.ePub) {
            Epubly.init();
            return;
        }

        // 2. If not found, show error
        const msg = "Nem sikerült betölteni a komponenseket. Kérlek, ellenőrizd az internetkapcsolatot.";
        document.getElementById('loader-msg').textContent = "Hiba";
        document.getElementById('loader-error').textContent = msg;
        document.getElementById('loader-error').style.display = 'block';
        document.getElementById('retry-btn').style.display = 'block';
    }
};

// Start boot sequence
DependencyLoader.boot();
