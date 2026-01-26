import { version } from './version.js';

// --- DEBUGGER MODULE ---
const Debug = {
    init() {
        // Simple console override if needed, stripped down for prod feeling
        window.onerror = (msg, url, line) => {
            console.error(`Epubly Error: ${msg} (${url}:${line})`);
        };
    }
};
Debug.init();

// --- MAIN APPLICATION ---
const Epubly = {
    state: {
        zip: null,
        currentBookId: null,
        spine: [], 
        manifest: {}, 
        toc: [], 
        rootPath: '', 
        activeBookSessionStart: null,
        metadata: {},
        renderedChapters: new Set(),
        observer: null,
        isLoadingNext: false,
        highlights: {},
        sidebarOpen: false
    },

    // --- ENGINE: Core Logic ---
    engine: {
        async loadBook(arrayBuffer, bookId) {
            Epubly.ui.showLoader("Könyv feldolgozása...");
            
            // Reset
            Epubly.state.zip = null;
            Epubly.state.spine = [];
            Epubly.state.manifest = {};
            Epubly.state.renderedChapters.clear();
            Epubly.state.currentBookId = bookId;
            Epubly.state.activeBookSessionStart = Date.now();
            Epubly.state.isLoadingNext = false;
            if(Epubly.state.observer) Epubly.state.observer.disconnect();

            // Load Highlights
            Epubly.highlights.load(bookId);

            try {
                if (!window.JSZip) throw new Error("JSZip hiányzik!");
                Epubly.state.zip = await JSZip.loadAsync(arrayBuffer);

                // Find OPF
                const containerXml = await Epubly.state.zip.file("META-INF/container.xml").async("string");
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, "application/xml");
                const rootfile = containerDoc.querySelector("rootfile");
                if(!rootfile) throw new Error("Hibás EPUB: Nincs rootfile.");
                
                const fullOpfPath = rootfile.getAttribute("full-path");
                const lastSlash = fullOpfPath.lastIndexOf('/');
                Epubly.state.rootPath = lastSlash !== -1 ? fullOpfPath.substring(0, lastSlash + 1) : '';

                // Parse OPF
                Epubly.ui.showLoader("Metaadatok...");
                const opfXml = await Epubly.state.zip.file(fullOpfPath).async("string");
                const opfDoc = parser.parseFromString(opfXml, "application/xml");

                // Manifest
                const manifestItems = opfDoc.getElementsByTagName("item");
                for (let item of manifestItems) {
                    Epubly.state.manifest[item.getAttribute("id")] = {
                        href: item.getAttribute("href"),
                        type: item.getAttribute("media-type"),
                        fullPath: Epubly.state.rootPath + item.getAttribute("href")
                    };
                }

                // Spine
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

                // Metadata
                const title = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || "Névtelen Könyv";
                const author = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || "Ismeretlen Szerző";
                Epubly.state.metadata = { title, author };
                
                // Initial Header Update (will be refined by observer)
                Epubly.ui.updateHeaderInfo(title, "");

                // Start Position
                let startIdx = 0;
                const savedCfi = Epubly.storage.getLocation(bookId);
                if(savedCfi) {
                    const idx = parseInt(savedCfi);
                    if(!isNaN(idx) && idx < Epubly.state.spine.length) startIdx = idx;
                }

                document.getElementById('viewer-content').innerHTML = '';
                Epubly.ui.showReaderView();
                
                await this.renderChapter(startIdx);
                this.initObservers();
                document.getElementById('viewer').onscroll = this.handleScroll.bind(this);

                Epubly.ui.hideLoader();
                this.parseTOC(opfDoc);

            } catch (e) {
                console.error("Engine Error:", e);
                alert("Hiba: " + e.message);
                Epubly.ui.hideLoader();
                Epubly.ui.showLibraryView();
            }
        },

        async renderChapter(index) {
            if (index < 0 || index >= Epubly.state.spine.length) return;
            if (Epubly.state.renderedChapters.has(index)) return;

            const chapterItem = Epubly.state.spine[index];
            const file = Epubly.state.zip.file(chapterItem.fullPath);
            if (!file) return;

            let htmlContent = await file.async("string");
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, "text/html");

            // Images replacement
            const images = doc.querySelectorAll("img, image");
            const processImage = async (img) => {
                const src = img.getAttribute("src") || img.getAttribute("href") || img.getAttribute("xlink:href");
                if (!src) return;
                const chapterDir = chapterItem.fullPath.substring(0, chapterItem.fullPath.lastIndexOf('/') + 1);
                const resolvedPath = this.resolvePath(chapterDir, src);
                const imgFile = Epubly.state.zip.file(resolvedPath);
                if (imgFile) {
                    const blob = await imgFile.async("blob");
                    const url = URL.createObjectURL(blob);
                    img.setAttribute("src", url);
                    if(img.tagName.toLowerCase() === 'image') img.setAttribute("href", url);
                }
            };
            await Promise.all(Array.from(images).map(processImage));

            // Container
            const chapterContainer = document.createElement('div');
            chapterContainer.className = 'chapter-container';
            chapterContainer.dataset.index = index;
            // Removed raw chapter output from here, handled in header
            chapterContainer.innerHTML = doc.body.innerHTML;

            document.getElementById('viewer-content').appendChild(chapterContainer);
            Epubly.state.renderedChapters.add(index);
            
            // Apply Settings Immediately
            Epubly.reader.applySettings(Epubly.settings.get());
            Epubly.highlights.apply(index, chapterContainer);
        },

        resolvePath(base, relative) {
            const stack = base.split("/");
            stack.pop();
            const parts = relative.split("/");
            for (let i = 0; i < parts.length; i++) {
                if (parts[i] === ".") continue;
                if (parts[i] === "..") stack.pop();
                else stack.push(parts[i]);
            }
            return stack.join("/");
        },

        initObservers() {
            const options = { root: document.getElementById('viewer'), threshold: 0.1 };
            Epubly.state.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const idx = parseInt(entry.target.dataset.index);
                        Epubly.storage.saveLocation(Epubly.state.currentBookId, idx);
                        
                        // Update Header: Title - ChapterName
                        // We try to find a heading in the chapter
                        let chapterName = "Fejezet " + (idx + 1);
                        const hTag = entry.target.querySelector('h1, h2, h3');
                        if(hTag && hTag.innerText.length < 50) chapterName = hTag.innerText;
                        
                        // Update UI
                        Epubly.ui.updateHeaderInfo(Epubly.state.metadata.title, chapterName);
                        Epubly.ui.updateProgress(idx, Epubly.state.spine.length);
                        
                        // Highlight TOC item
                        Epubly.toc.highlight(idx);
                    }
                });
            }, options);

            document.querySelectorAll('.chapter-container').forEach(el => Epubly.state.observer.observe(el));
            
            const containerObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.classList.contains('chapter-container')) {
                            Epubly.state.observer.observe(node);
                        }
                    });
                });
            });
            containerObserver.observe(document.getElementById('viewer-content'), { childList: true });
        },

        async handleScroll(e) {
            const viewer = e.target;
            if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 400) {
                if(Epubly.state.isLoadingNext) return;
                const renderedIndices = Array.from(Epubly.state.renderedChapters).sort((a,b) => a-b);
                const lastIdx = renderedIndices[renderedIndices.length - 1];
                if (lastIdx < Epubly.state.spine.length - 1) {
                    Epubly.state.isLoadingNext = true;
                    document.getElementById('scroll-loader').style.display = 'block';
                    await this.renderChapter(lastIdx + 1);
                    document.getElementById('scroll-loader').style.display = 'none';
                    Epubly.state.isLoadingNext = false;
                }
            }
        },

        async parseTOC(opfDoc) {
            let tocId = opfDoc.getElementsByTagName("spine")[0].getAttribute("toc");
            let tocPath = "";
            if(tocId && Epubly.state.manifest[tocId]) {
                tocPath = Epubly.state.manifest[tocId].fullPath;
            } else {
                for(let key in Epubly.state.manifest) {
                    if(Epubly.state.manifest[key].href.indexOf("toc") > -1) {
                        tocPath = Epubly.state.manifest[key].fullPath;
                        break;
                    }
                }
            }
            if(!tocPath) { Epubly.toc.generate([]); return; }

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
                        const cleanHref = content.split('#')[0];
                        const tocDir = tocPath.substring(0, tocPath.lastIndexOf('/') + 1);
                        const fullHref = this.resolvePath(tocDir, cleanHref);
                        let spineIdx = -1;
                        Epubly.state.spine.forEach((s, idx) => { if(s.fullPath === fullHref) spineIdx = idx; });
                        if(spineIdx !== -1) tocItems.push({ label: label, index: spineIdx });
                    }
                }
                Epubly.toc.generate(tocItems);
            } catch(e) { console.warn("TOC Error", e); Epubly.toc.generate([]); }
        }
    },

    // --- SEARCH MODULE ---
    search: {
        async run(query) {
            if(!Epubly.state.zip || !query || query.length < 3) return;
            
            const resultsDiv = document.getElementById('search-results');
            const progress = document.getElementById('search-progress');
            document.getElementById('search-status').style.display = 'block';
            resultsDiv.innerHTML = '';
            
            let count = 0;
            const spine = Epubly.state.spine;
            const q = query.toLowerCase();

            for (let i = 0; i < spine.length; i++) {
                progress.textContent = `${Math.round((i/spine.length)*100)}%`;
                const file = Epubly.state.zip.file(spine[i].fullPath);
                if(file) {
                    const text = await file.async("string");
                    const cleanText = text.replace(/<[^>]*>/g, ' '); 
                    const lowerText = cleanText.toLowerCase();
                    const index = lowerText.indexOf(q);
                    
                    if(index > -1) {
                        count++;
                        const snippet = cleanText.substring(Math.max(0, index - 40), Math.min(cleanText.length, index + 40));
                        
                        const item = document.createElement('div');
                        item.className = 'search-result-item';
                        item.innerHTML = `
                            <div class="search-result-chapter">Fejezet ${i + 1}</div>
                            <div class="search-result-text">...${snippet.replace(new RegExp(query, 'gi'), match => `<span class="search-highlight">${match}</span>`)}...</div>
                        `;
                        item.onclick = () => {
                            Epubly.ui.hideModal('search-modal');
                            document.getElementById('viewer-content').innerHTML = '';
                            Epubly.state.renderedChapters.clear();
                            Epubly.engine.renderChapter(i);
                        };
                        resultsDiv.appendChild(item);
                        if(count > 50) break; 
                    }
                }
                if(i % 5 === 0) await new Promise(r => setTimeout(r, 0));
            }
            
            document.getElementById('search-status').style.display = 'none';
            if(count === 0) resultsDiv.innerHTML = '<p style="text-align:center; padding:20px;">Nincs találat.</p>';
        }
    },

    // --- LIGHTBOX ---
    lightbox: {
        init() {
            const box = document.getElementById('lightbox');
            const img = document.getElementById('lightbox-img');
            const close = document.querySelector('.lightbox-close');
            
            document.getElementById('viewer-content').addEventListener('click', (e) => {
                if(e.target.tagName === 'IMG') {
                    img.src = e.target.src;
                    box.classList.add('visible');
                }
            });

            const hide = () => box.classList.remove('visible');
            close.onclick = hide;
            box.onclick = (e) => { if(e.target === box) hide(); };
        }
    },

    // --- HIGHLIGHTS ---
    highlights: {
        load(bookId) {
            const saved = localStorage.getItem(`epubly-highlights-${bookId}`);
            Epubly.state.highlights[bookId] = saved ? JSON.parse(saved) : [];
        },
        save() {
            const bookId = Epubly.state.currentBookId;
            if(bookId) localStorage.setItem(`epubly-highlights-${bookId}`, JSON.stringify(Epubly.state.highlights[bookId]));
        },
        add() {
            const selection = window.getSelection();
            if(!selection.rangeCount) return;
            const text = selection.toString();
            if(!text || text.length < 3) return;

            let node = selection.anchorNode;
            let chapterDiv = null;
            while(node && node.id !== 'viewer-content') {
                if(node.classList && node.classList.contains('chapter-container')) {
                    chapterDiv = node;
                    break;
                }
                node = node.parentNode;
            }

            if(chapterDiv) {
                const idx = parseInt(chapterDiv.dataset.index);
                const bookId = Epubly.state.currentBookId;
                
                const range = selection.getRangeAt(0);
                const span = document.createElement('span');
                span.className = 'highlighted-text';
                try { range.surroundContents(span); } catch(e) { console.warn(e); return; }

                if(!Epubly.state.highlights[bookId]) Epubly.state.highlights[bookId] = [];
                Epubly.state.highlights[bookId].push({
                    chapterIndex: idx,
                    text: text,
                    date: Date.now()
                });
                this.save();
                document.getElementById('highlight-menu').style.opacity = '0';
                selection.removeAllRanges();
            }
        },
        apply(chapterIndex, container) {
            const bookId = Epubly.state.currentBookId;
            const items = Epubly.state.highlights[bookId];
            if(!items) return;
            items.forEach(h => {
                if(h.chapterIndex === chapterIndex) {
                    if(!container.innerHTML.includes(`<span class="highlighted-text">${h.text}</span>`)) {
                         container.innerHTML = container.innerHTML.replace(h.text, `<span class="highlighted-text">${h.text}</span>`);
                    }
                }
            });
        }
    },

    reader: {
        updateSessionStats() {
            if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
            const now = Date.now();
            const duration = now - Epubly.state.activeBookSessionStart;
            Epubly.state.activeBookSessionStart = now;
            
            let maxRendered = 0;
            if(Epubly.state.renderedChapters.size > 0) {
                maxRendered = Math.max(...Epubly.state.renderedChapters);
            }
            const progress = (maxRendered + 1) / Epubly.state.spine.length;
            Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, progress);
        },
        applySettings(settings) {
            const viewer = document.getElementById('viewer-content');
            if(!viewer) return;
            
            // Set styles on the viewer container
            viewer.style.fontFamily = settings.fontFamily;
            viewer.style.fontSize = settings.fontSize + "%";
            viewer.style.lineHeight = settings.lineHeight;
            viewer.style.textAlign = settings.textAlign;
            const pad = settings.margin + "%";
            viewer.style.paddingLeft = pad;
            viewer.style.paddingRight = pad;
            
            // Critical: Force text color on all children to fix visibility issues
            const styleId = 'epubly-dynamic-styles';
            let styleTag = document.getElementById(styleId);
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = styleId;
                document.head.appendChild(styleTag);
            }
            
            styleTag.textContent = `
                #viewer-content, #viewer-content * {
                    color: ${settings.textColor} !important;
                    background-color: transparent !important;
                }
                body, #reader-main {
                    background-color: ${settings.bgColor};
                }
            `;
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
                a.style.padding = "8px 12px";
                a.style.color = "var(--text-muted)";
                a.style.textDecoration = "none";
                a.style.cursor = "pointer";
                a.style.borderRadius = "4px";
                a.style.fontSize = "0.9rem";
                a.dataset.idx = item.index;
                a.className = "toc-link";
                
                a.onclick = () => {
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(item.index);
                    Epubly.ui.toggleSidebar(); // Auto Close
                };
                li.appendChild(a);
                fragment.appendChild(li);
            });
            tocList.appendChild(fragment);
        },
        highlight(idx) {
            document.querySelectorAll('.toc-link').forEach(el => {
                if(parseInt(el.dataset.idx) === idx) {
                    el.style.color = "var(--brand)";
                    el.style.fontWeight = "bold";
                    el.scrollIntoView({ block: "center", behavior: "smooth" });
                } else {
                    el.style.color = "var(--text-muted)";
                    el.style.fontWeight = "normal";
                }
            });
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
            const clearBtn = document.getElementById('btn-clear-cache');
            if(clearBtn) clearBtn.addEventListener('click', Epubly.storage.clearAllBooks);
        },
        get() {
            const defaults = {
                fontSize: '100', lineHeight: '1.6', margin: '15',
                theme: 'oled', textAlign: 'left', fontFamily: "'Inter', sans-serif",
                textColor: '#F0F0F0', bgColor: '#050505'
            };
            const saved = JSON.parse(localStorage.getItem('epubly-settings')) || {};
            return { ...defaults, ...saved };
        },
        save(settings) { localStorage.setItem('epubly-settings', JSON.stringify(settings)); },
        load() {
            const s = this.get();
            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
            setVal('font-size-range', s.fontSize);
            setVal('line-height-range', s.lineHeight);
            setVal('margin-range', s.margin);
            setVal('text-color-picker', s.textColor);
            setVal('bg-color-picker', s.bgColor);
            setVal('font-family-select', s.fontFamily);
            const updateToggle = (groupId, val) => {
                const g = document.getElementById(groupId);
                if(g) g.querySelectorAll('.toggle-btn').forEach(b => { b.classList.toggle('active', b.dataset.val === val); });
            };
            updateToggle('align-toggle-group', s.textAlign);
            updateToggle('theme-toggle-group', s.theme);
            const customContainer = document.getElementById('custom-theme-container');
            if(customContainer) customContainer.style.display = s.theme === 'custom' ? 'block' : 'none';
            Epubly.reader.applySettings(s);
        },
        handleUpdate(key, value) {
            const s = this.get();
            s[key] = value;
            if(key === 'theme') {
                const customContainer = document.getElementById('custom-theme-container');
                if(customContainer) customContainer.style.display = value === 'custom' ? 'block' : 'none';
                const presets = {
                    oled: { textColor: '#F0F0F0', bgColor: '#000000' },
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
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);
                const containerXml = await zip.file("META-INF/container.xml").async("string");
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, "application/xml");
                const fullOpfPath = containerDoc.querySelector("rootfile").getAttribute("full-path");
                const opfXml = await zip.file(fullOpfPath).async("string");
                const opfDoc = parser.parseFromString(opfXml, "application/xml");
                
                const title = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || "Névtelen";
                const author = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || "Ismeretlen";
                const desc = opfDoc.getElementsByTagName("dc:description")[0]?.textContent || "";
                
                let coverUrl = null;
                const rootPath = fullOpfPath.includes('/') ? fullOpfPath.substring(0, fullOpfPath.lastIndexOf('/') + 1) : '';
                let coverItem = opfDoc.querySelector("item[properties~='cover-image']");
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
                    metadata: { title, creator: author, description: desc, coverUrl },
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
                    if(percentage !== null && !isNaN(percentage)) book.stats.progress = percentage;
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
                    card.className = 'book-card glow-effect';
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

    ui: {
        init() {
            document.getElementById('btn-close-sidebar').addEventListener('click', () => {
                Epubly.ui.toggleSidebar();
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

            // Highlight Menu Listener
            document.addEventListener('selectionchange', () => {
                const sel = window.getSelection();
                const menu = document.getElementById('highlight-menu');
                if(!sel.isCollapsed && sel.toString().length > 2) {
                    const range = sel.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    menu.style.opacity = '1';
                    menu.style.pointerEvents = 'auto';
                    menu.style.top = (rect.bottom + window.scrollY + 10) + 'px';
                    menu.style.left = (rect.left + window.scrollX) + 'px';
                } else {
                    menu.style.opacity = '0';
                    menu.style.pointerEvents = 'none';
                }
            });
            document.getElementById('btn-highlight-save').onclick = () => Epubly.highlights.add();

            document.getElementById('btn-do-search').onclick = () => {
                const val = document.getElementById('search-input').value;
                Epubly.search.run(val);
            };
            
            // Global Click to close sidebar
            document.addEventListener('click', (e) => {
                const sidebar = document.getElementById('reader-sidebar-right');
                const btn = document.getElementById('btn-toggle-sidebar');
                if(Epubly.state.sidebarOpen && sidebar && !sidebar.contains(e.target) && (!btn || !btn.contains(e.target))) {
                    Epubly.ui.toggleSidebar();
                }
            });
        },
        toggleSidebar() {
            const sb = document.getElementById('reader-sidebar-right');
            Epubly.state.sidebarOpen = !Epubly.state.sidebarOpen;
            if(Epubly.state.sidebarOpen) {
                sb.classList.add('visible');
            } else {
                sb.classList.remove('visible');
            }
        },
        showModal(id) { document.getElementById(id).classList.add('visible'); },
        hideModal(id) { document.getElementById(id).classList.remove('visible'); },
        showLoader(msg) { 
            document.getElementById('loader').classList.remove('hidden');
            if(msg) document.getElementById('loader-msg').textContent = msg;
        },
        hideLoader() { document.getElementById('loader').classList.add('hidden'); },
        updateHeaderInfo(title, chapter) {
            document.getElementById('header-title-text').textContent = title;
            document.getElementById('header-chapter-text').textContent = chapter;
        },
        updateProgress(current, total) {
            const ind = document.getElementById('progress-indicator');
            if(ind && total > 0) {
                const pct = Math.round(((current + 1) / total) * 100);
                ind.textContent = `${pct}%`;
            }
        },
        showReaderView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('reader-view').classList.add('active');
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <div id="progress-indicator">0%</div>
                <button class="icon-btn" onclick="Epubly.ui.showModal('search-modal')" title="Keresés">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                </button>
                <button class="icon-btn" onclick="Epubly.ui.showModal('settings-modal')" title="Beállítások">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
                <button class="icon-btn" id="btn-toggle-sidebar" onclick="Epubly.ui.toggleSidebar()" title="Tartalom">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
            `;
        },
        showLibraryView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('library-view').classList.add('active');
            this.updateHeaderInfo('Könyvtár', '');
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <button class="btn btn-primary" onclick="Epubly.ui.showModal('import-modal')">Importálás</button>
                <button class="icon-btn" onclick="Epubly.ui.showModal('settings-modal')" title="Beállítások">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </button>
            `;
            Epubly.library.render();
        },
        showBookInfoModal(book) {
            document.getElementById('detail-cover-img').src = book.metadata.coverUrl || '';
            document.getElementById('detail-title').textContent = book.metadata.title;
            document.getElementById('detail-author').textContent = book.metadata.creator;
            document.getElementById('detail-desc').innerHTML = book.metadata.description || "Leírás nem elérhető.";
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
            console.log("Epubly initializing...");
            
            if(!this.ui || !this.library || !this.settings || !this.storage) {
                throw new Error("Initialization failed: Modules missing.");
            }

            this.ui.init();
            this.settings.init();
            this.lightbox.init();
            await this.storage.db.init();
            
            this.ui.showLibraryView();
            this.ui.hideLoader();
            
            console.log(`Epubly v${version} Initialized.`);
        } catch (error) {
            console.error("Fatal init error:", error);
            document.getElementById('loader').classList.remove('hidden');
            document.getElementById('loader-error').textContent = error.message;
            document.getElementById('loader-error').style.display = 'block';
        }
    }
};

window.Epubly = Epubly;

const DependencyLoader = {
    async boot() {
        if (window.JSZip) {
            Epubly.init();
            return;
        }
        const msg = "A JSZip könyvtár nem töltődött be.";
        console.error(msg);
        document.getElementById('loader-error').textContent = msg;
        document.getElementById('loader-error').style.display = 'block';
        document.getElementById('retry-btn').style.display = 'block';
    }
};

DependencyLoader.boot();
