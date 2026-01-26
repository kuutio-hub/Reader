import { version } from './version.js';

const Epubly = {
    state: {
        zip: null,
        currentBookId: null,
        currentChapterIndex: 0,
        spine: [], // Array of { id, href, fullPath }
        manifest: {}, // Map id -> { href, type, fullPath }
        toc: [], // Array of { label, href, fullPath }
        rootPath: '', // e.g., "OPS/"
        activeBookSessionStart: null,
        metadata: {}
    },

    // --- CUSTOM NATIVE ENGINE ---
    engine: {
        async loadBook(arrayBuffer, bookId) {
            Epubly.ui.showLoader("Könyv kibontása...");
            
            // Reset State
            Epubly.state.zip = null;
            Epubly.state.spine = [];
            Epubly.state.manifest = {};
            Epubly.state.currentChapterIndex = 0;
            Epubly.state.currentBookId = bookId;
            Epubly.state.activeBookSessionStart = Date.now();

            try {
                // 1. Unzip
                if (!window.JSZip) throw new Error("JSZip könyvtár hiányzik.");
                Epubly.state.zip = await JSZip.loadAsync(arrayBuffer);

                // 2. Find Root File (OPF) from META-INF/container.xml
                const containerXml = await Epubly.state.zip.file("META-INF/container.xml").async("string");
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, "application/xml");
                const rootfile = containerDoc.querySelector("rootfile");
                if(!rootfile) throw new Error("Hibás EPUB: Nincs rootfile.");
                
                const fullOpfPath = rootfile.getAttribute("full-path");
                // Store the directory of the OPF to resolve relative paths later
                const lastSlash = fullOpfPath.lastIndexOf('/');
                Epubly.state.rootPath = lastSlash !== -1 ? fullOpfPath.substring(0, lastSlash + 1) : '';

                // 3. Parse OPF
                Epubly.ui.showLoader("Struktúra elemzése...");
                const opfXml = await Epubly.state.zip.file(fullOpfPath).async("string");
                const opfDoc = parser.parseFromString(opfXml, "application/xml");

                // Parse Manifest
                const manifestItems = opfDoc.getElementsByTagName("item");
                for (let item of manifestItems) {
                    const id = item.getAttribute("id");
                    const href = item.getAttribute("href");
                    const mediaType = item.getAttribute("media-type");
                    Epubly.state.manifest[id] = {
                        href: href,
                        type: mediaType,
                        // Relative to root
                        fullPath: Epubly.state.rootPath + href
                    };
                }

                // Parse Spine
                const spineItems = opfDoc.getElementsByTagName("itemref");
                for (let item of spineItems) {
                    const idref = item.getAttribute("idref");
                    const manifestItem = Epubly.state.manifest[idref];
                    if (manifestItem) {
                        Epubly.state.spine.push({
                            id: idref,
                            href: manifestItem.href,
                            fullPath: manifestItem.fullPath
                        });
                    }
                }

                // Get Metadata (Title)
                const titleElem = opfDoc.getElementsByTagName("dc:title")[0];
                const title = titleElem ? titleElem.textContent : "Ismeretlen Könyv";
                Epubly.ui.updateHeaderTitle(title);

                // 4. Load saved position
                const savedCfi = Epubly.storage.getLocation(bookId);
                // Simple integer index for now
                if(savedCfi) {
                    const idx = parseInt(savedCfi);
                    if(!isNaN(idx) && idx < Epubly.state.spine.length) {
                        Epubly.state.currentChapterIndex = idx;
                    }
                }

                // 5. Render First Chapter
                await this.renderChapter(Epubly.state.currentChapterIndex);
                
                Epubly.ui.showReaderView();
                Epubly.ui.hideLoader();

                // 6. Try to parse TOC (for Sidebar)
                this.parseTOC(opfDoc);

            } catch (e) {
                console.error("Native Engine Error:", e);
                alert("Hiba a könyv betöltésekor: " + e.message);
                Epubly.ui.hideLoader();
                Epubly.ui.showLibraryView();
            }
        },

        async renderChapter(index) {
            Epubly.ui.showLoader("Fejezet betöltése...");
            
            if (index < 0 || index >= Epubly.state.spine.length) {
                Epubly.ui.hideLoader();
                return;
            }

            const chapterItem = Epubly.state.spine[index];
            const file = Epubly.state.zip.file(chapterItem.fullPath);
            
            if (!file) {
                document.getElementById('viewer-content').innerHTML = "<p style='color:red'>Hiba: A fájl nem található a ZIP-ben: " + chapterItem.fullPath + "</p>";
                Epubly.ui.hideLoader();
                return;
            }

            // Load HTML string
            let htmlContent = await file.async("string");

            // Clean content using DOMParser
            const parser = new DOMParser();
            // Using 'text/html' is more forgiving than 'application/xhtml+xml'
            const doc = parser.parseFromString(htmlContent, "text/html");

            // --- IMAGE HANDLING (The crucial part) ---
            // Find all images and replace src with ObjectURLs from Zip blobs
            const images = doc.getElementsByTagName("img");
            // Also svg images
            const svgImages = doc.getElementsByTagName("image");
            
            const processImage = async (img) => {
                const src = img.getAttribute("src") || img.getAttribute("href") || img.getAttribute("xlink:href");
                if (!src) return;
                
                // Resolve path relative to current chapter
                const chapterDir = chapterItem.fullPath.substring(0, chapterItem.fullPath.lastIndexOf('/') + 1);
                // Basic path resolution (handling ../)
                const resolvedPath = this.resolvePath(chapterDir, src);
                
                const imgFile = Epubly.state.zip.file(resolvedPath);
                if (imgFile) {
                    const blob = await imgFile.async("blob");
                    const url = URL.createObjectURL(blob);
                    img.setAttribute("src", url);
                    // For SVG image tag
                    if(img.tagName.toLowerCase() === 'image') img.setAttribute("href", url);
                }
            };

            const promises = [];
            for (let img of images) promises.push(processImage(img));
            for (let img of svgImages) promises.push(processImage(img));
            await Promise.all(promises);

            // Extract body content
            const bodyContent = doc.body.innerHTML;
            
            const viewerContent = document.getElementById('viewer-content');
            viewerContent.innerHTML = bodyContent;

            // Scroll to top
            document.getElementById('viewer').scrollTop = 0;

            // Update Navigation UI
            this.updateNavigationUI(index);
            
            // Apply Settings
            Epubly.reader.applySettings(Epubly.settings.get());

            // Save location
            Epubly.storage.saveLocation(Epubly.state.currentBookId, index);
            Epubly.state.currentChapterIndex = index;

            Epubly.ui.hideLoader();
        },

        resolvePath(base, relative) {
            const stack = base.split("/");
            stack.pop(); // Remove empty trailing or filename
            const parts = relative.split("/");
            for (let i = 0; i < parts.length; i++) {
                if (parts[i] === ".") continue;
                if (parts[i] === "..") stack.pop();
                else stack.push(parts[i]);
            }
            return stack.join("/");
        },

        updateNavigationUI(index) {
            const container = document.getElementById('viewer-nav-controls');
            if(!container) return;

            const total = Epubly.state.spine.length;
            let html = `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">`;
            
            if(index > 0) {
                html += `<button class="chapter-nav-btn" onclick="Epubly.engine.prevChapter()">&#8592; Előző fejezet</button>`;
            } else {
                html += `<div></div>`;
            }

            html += `<span style="color:var(--text-muted); font-size:0.8rem;">${index + 1} / ${total}</span>`;

            if(index < total - 1) {
                html += `<button class="chapter-nav-btn" onclick="Epubly.engine.nextChapter()">Következő fejezet &#8594;</button>`;
            } else {
                html += `<div></div>`;
            }
            
            html += `</div>`;
            container.innerHTML = html;
        },

        prevChapter() {
            this.renderChapter(Epubly.state.currentChapterIndex - 1);
        },

        nextChapter() {
            this.renderChapter(Epubly.state.currentChapterIndex + 1);
        },

        async parseTOC(opfDoc) {
            // Very basic TOC parsing (NCX or Nav)
            // 1. Try manifest for .ncx
            let tocId = opfDoc.getElementsByTagName("spine")[0].getAttribute("toc");
            let tocPath = "";
            
            if(tocId && Epubly.state.manifest[tocId]) {
                tocPath = Epubly.state.manifest[tocId].fullPath;
            } else {
                // Fallback: look for "nav" property
                for(let key in Epubly.state.manifest) {
                    if(Epubly.state.manifest[key].href.indexOf("toc") > -1) {
                        tocPath = Epubly.state.manifest[key].fullPath;
                        break;
                    }
                }
            }

            if(!tocPath) {
                Epubly.toc.generate([]);
                return;
            }

            try {
                const tocXml = await Epubly.state.zip.file(tocPath).async("string");
                const parser = new DOMParser();
                const tocDoc = parser.parseFromString(tocXml, "application/xml");
                
                const navPoints = tocDoc.getElementsByTagName("navPoint");
                const tocItems = [];

                for(let point of navPoints) {
                    const label = point.getElementsByTagName("text")[0]?.textContent;
                    const content = point.getElementsByTagName("content")[0]?.getAttribute("src");
                    
                    if(label && content) {
                        // Find spine index for this href
                        // content might include hash (chapter.html#id)
                        const cleanHref = content.split('#')[0];
                        // We need to resolve full path to match manifest
                        const tocDir = tocPath.substring(0, tocPath.lastIndexOf('/') + 1);
                        const fullHref = this.resolvePath(tocDir, cleanHref);

                        // Find index in spine
                        let spineIdx = -1;
                        Epubly.state.spine.forEach((s, idx) => {
                            if(s.fullPath === fullHref) spineIdx = idx;
                        });

                        if(spineIdx !== -1) {
                            tocItems.push({ label: label, index: spineIdx });
                        }
                    }
                }
                Epubly.toc.generate(tocItems);

            } catch(e) {
                console.warn("TOC parse failed", e);
                Epubly.toc.generate([]);
            }
        }
    },

    reader: {
        // Wrapper for legacy calls, redirected to engine
        async loadBook(bookData, bookId) {
            return Epubly.engine.loadBook(bookData, bookId);
        },
        updateSessionStats() {
            // Stats logic remains mostly the same, simplified
            if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
            const now = Date.now();
            const duration = now - Epubly.state.activeBookSessionStart;
            Epubly.state.activeBookSessionStart = now;
            
            // Calc progress based on chapter index
            let progress = 0;
            if(Epubly.state.spine.length > 0) {
                progress = Epubly.state.currentChapterIndex / Epubly.state.spine.length;
            }
            Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, progress);
        },
        nextPage() { Epubly.engine.nextChapter(); },
        prevPage() { Epubly.engine.prevChapter(); },
        
        applySettings(settings) {
            const viewer = document.getElementById('viewer-content');
            if(!viewer) return;

            // Apply Typography
            viewer.style.fontFamily = settings.fontFamily;
            viewer.style.fontSize = settings.fontSize + "%";
            viewer.style.lineHeight = settings.lineHeight;
            viewer.style.textAlign = settings.textAlign;
            viewer.style.letterSpacing = settings.letterSpacing + "px";
            
            // Width constraint
            // Map margin-range (0-35) or width (300-1200) to max-width
            // If the old slider is used, it's small, if new one, it's pixels
            let mw = settings.margin;
            if(mw < 100) mw = 800; // default fallback if old setting
            viewer.style.maxWidth = mw + "px";

            // Colors
            viewer.style.color = settings.textColor;
            document.getElementById('reader-main').style.backgroundColor = settings.bgColor;
            document.body.style.backgroundColor = settings.bgColor; // Global bg for overscroll

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
            tocItems.forEach(item => {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.textContent = item.label || "Fejezet " + (item.index + 1);
                a.style.display = "block";
                a.style.padding = "8px";
                a.style.color = "var(--text-muted)";
                a.style.textDecoration = "none";
                a.style.cursor = "pointer";
                a.style.borderRadius = "4px";
                
                a.onclick = () => {
                    Epubly.engine.renderChapter(item.index);
                    if(window.innerWidth < 800) {
                        document.getElementById('reader-sidebar-left').classList.remove('visible');
                    }
                };
                
                // Highlight active
                if(item.index === Epubly.state.currentChapterIndex) {
                    a.style.color = "var(--brand)";
                    a.style.fontWeight = "bold";
                }

                li.appendChild(a);
                fragment.appendChild(li);
            });
            tocList.appendChild(fragment);
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
            // bindInput('letter-spacing-range', 'letterSpacing');
            bindInput('margin-range', 'margin');
            bindInput('bg-color-picker', 'bgColor');
            bindInput('text-color-picker', 'textColor');
            
            const bindToggleGroup = (groupId, key) => {
                const group = document.getElementById(groupId);
                if(!group) return;
                group.querySelectorAll('.toggle-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        this.handleUpdate(key, btn.dataset.val);
                    });
                });
            }

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
                fontSize: '100', lineHeight: '1.6', letterSpacing: '0', margin: '800',
                theme: 'oled', textAlign: 'left', fontFamily: "'Inter', sans-serif",
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
            setVal('margin-range', s.margin);
            setVal('text-color-picker', s.textColor);
            setVal('bg-color-picker', s.bgColor);
            setVal('font-family-select', s.fontFamily);
            setVal('pattern-select', s.pattern);

            const updateToggle = (groupId, val) => {
                const g = document.getElementById(groupId);
                if(g) {
                    g.querySelectorAll('.toggle-btn').forEach(b => {
                        b.classList.toggle('active', b.dataset.val === val);
                    });
                }
            };
            updateToggle('align-toggle-group', s.textAlign);
            updateToggle('theme-toggle-group', s.theme);

            Epubly.reader.applySettings(s);
        },

        handleUpdate(key, value) {
            const s = this.get();
            
            // Preset handling
            if(key === 'theme') {
                const presets = {
                    oled: { textColor: '#EDEDED', bgColor: '#000000' },
                    sepia: { textColor: '#5b4636', bgColor: '#fbf0d9' },
                    light: { textColor: '#111111', bgColor: '#ffffff' },
                };
                if(presets[value]) {
                    s.textColor = presets[value].textColor;
                    s.bgColor = presets[value].bgColor;
                    const tcp = document.getElementById('text-color-picker'); if(tcp) tcp.value = s.textColor;
                    const bcp = document.getElementById('bg-color-picker'); if(bcp) bcp.value = s.bgColor;
                }
            }
            
            s[key] = value;
            this.save(s);
            this.load();
        }
    },

    storage: {
        db: {
            _db: null,
            async init() {
                return new Promise((resolve, reject) => {
                    if (this._db) return resolve(this._db);
                    const request = indexedDB.open('EpublyDB', 4);
                    request.onerror = e => reject("IndexedDB error");
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
        async handleFileUpload(file) {
            Epubly.ui.showLoader('Feldolgozás...');
            Epubly.ui.hideModal('import-modal');
            
            try {
                // Parse basics with JSZip just to get cover/metadata for library view
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);
                
                // --- QUICK METADATA EXTRACTION ---
                const containerXml = await zip.file("META-INF/container.xml").async("string");
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, "application/xml");
                const fullOpfPath = containerDoc.querySelector("rootfile").getAttribute("full-path");
                const opfXml = await zip.file(fullOpfPath).async("string");
                const opfDoc = parser.parseFromString(opfXml, "application/xml");
                
                const title = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || "Névtelen";
                const author = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || "Ismeretlen";
                
                // Cover extraction (simplified)
                let coverUrl = null;
                const rootPath = fullOpfPath.includes('/') ? fullOpfPath.substring(0, fullOpfPath.lastIndexOf('/') + 1) : '';
                // Look for item with properties="cover-image"
                let coverItem = opfDoc.querySelector("item[properties~='cover-image']");
                // Fallback: search id="cover"
                if (!coverItem) coverItem = opfDoc.querySelector("item[id='cover']");
                
                if (coverItem) {
                    const href = coverItem.getAttribute("href");
                    const coverFile = zip.file(rootPath + href);
                    if(coverFile) {
                        const blob = await coverFile.async("blob");
                        coverUrl = await new Promise(r => {
                            const reader = new FileReader();
                            reader.onload = () => r(reader.result);
                            reader.readAsDataURL(blob);
                        });
                    }
                }

                const bookRecord = {
                    id: `${Date.now()}`,
                    data: arrayBuffer,
                    metadata: { title, creator: author, coverUrl },
                    stats: { totalTime: 0, progress: 0, lastRead: Date.now() }
                };

                await this.db.saveBook(bookRecord);
                
                setTimeout(async () => {
                    await Epubly.library.render();
                    Epubly.ui.hideLoader();
                }, 200);

            } catch (error) {
                console.error(error);
                alert("Hiba: " + error.message);
                Epubly.ui.hideLoader();
            }
        },
        async updateBookStats(bookId, durationDelta, percentage) {
            try {
                const book = await this.db.getBook(bookId);
                if(book) {
                    if(!book.stats) book.stats = { totalTime: 0, progress: 0, lastRead: Date.now() };
                    if(durationDelta > 0 && durationDelta < 86400000) book.stats.totalTime += durationDelta;
                    if(percentage !== null) book.stats.progress = percentage;
                    book.stats.lastRead = Date.now();
                    await this.db.saveBook(book);
                }
            } catch(e) {}
        },
        getLocation(bookId) { return localStorage.getItem(`epubly-loc-${bookId}`); },
        saveLocation(bookId, loc) { localStorage.setItem(`epubly-loc-${bookId}`, loc); },
        async clearAllBooks() {
            if (confirm("Minden törölve lesz. Folytatod?")) {
                await Epubly.storage.db.clearBooks();
                location.reload();
            }
        }
    },

    ui: {
        init() {
            document.getElementById('btn-close-sidebar').addEventListener('click', () => {
                document.getElementById('reader-sidebar-left').classList.remove('visible');
            });

            document.getElementById('app-logo-btn').addEventListener('click', () => {
                Epubly.reader.updateSessionStats();
                Epubly.ui.showLibraryView();
            });

            const fileInput = document.getElementById('epub-file');
            if(fileInput) {
                fileInput.addEventListener('change', (e) => {
                    if(e.target.files.length > 0) {
                        Epubly.storage.handleFileUpload(e.target.files[0]);
                        e.target.value = '';
                    }
                });
            }

            document.querySelectorAll('.modal-close').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.target.closest('.modal').classList.remove('visible');
                });
            });
            
            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', (e) => {
                    if(e.target === modal) modal.classList.remove('visible');
                });
            });
        },
        showModal(id) { document.getElementById(id).classList.add('visible'); },
        hideModal(id) { document.getElementById(id).classList.remove('visible'); },
        showLoader(msg) { 
            document.getElementById('loader').classList.remove('hidden');
            if(msg) document.getElementById('loader-msg').textContent = msg;
        },
        hideLoader() { document.getElementById('loader').classList.add('hidden'); },
        
        updateHeaderTitle(title) {
            document.getElementById('header-title-text').textContent = title;
        },

        showReaderView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('reader-view').classList.add('active');
            
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <button class="btn btn-secondary" onclick="Epubly.reader.updateSessionStats(); Epubly.ui.showLibraryView()">Vissza</button>
                <button class="icon-btn" onclick="document.getElementById('reader-sidebar-left').classList.add('visible')" title="Tartalom">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                <button class="icon-btn" onclick="Epubly.ui.showModal('settings-modal')" title="Beállítások">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            `;
        },
        showLibraryView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('library-view').classList.add('active');
            
            this.updateHeaderTitle('Könyvtár');
            
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <button class="btn btn-primary" onclick="Epubly.ui.showModal('import-modal')">Importálás</button>
                <button class="icon-btn" onclick="Epubly.ui.showModal('settings-modal')" title="Beállítások">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            `;

            Epubly.library.render();
        },
        showBookInfoModal(book) {
            document.getElementById('detail-cover-img').src = book.metadata.coverUrl || '';
            document.getElementById('detail-title').textContent = book.metadata.title;
            document.getElementById('detail-author').textContent = book.metadata.creator;
            document.getElementById('detail-desc').innerHTML = "Leírás nem elérhető.";
            
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
                // Use Native Engine
                Epubly.engine.loadBook(book.data, book.id);
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
            
            this.ui.showLibraryView();
            this.ui.hideLoader();
            
            console.log(`Epubly v${version} Native Engine Initialized.`);
        } catch (error) {
            console.error("Fatal init error:", error);
            this.ui.showLoader("Hiba történt!");
            document.getElementById('loader-error').textContent = error.message;
            document.getElementById('loader-error').style.display = 'block';
        }
    }
};

window.Epubly = Epubly;

const DependencyLoader = {
    async boot() {
        document.getElementById('loader-msg').textContent = "Inicializálás...";
        if (window.JSZip) {
            Epubly.init();
            return;
        }
        const msg = "A JSZip könyvtár nem töltődött be.";
        document.getElementById('loader-msg').textContent = "Hiba";
        document.getElementById('loader-error').textContent = msg;
        document.getElementById('loader-error').style.display = 'block';
        document.getElementById('retry-btn').style.display = 'block';
    }
};

DependencyLoader.boot();
