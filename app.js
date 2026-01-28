import { version } from './version.js';

// --- DEBUGGER MODULE ---
const Debug = {
    init() {
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
        pdfDoc: null, // For PDF support
        currentFormat: null, // 'epub' or 'pdf'
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
        isLoadingPrev: false,
        highlights: {},
        activeSidebar: null,
        history: [], 
        selectedHighlightId: null,
        ctxMenuHighlightId: null,
        currentPageInChapter: 1,
        totalPagesInChapter: 1,
        // PDF specific
        pdfScale: 2.0, // Render high res for clear zooming
        pdfLayout: 'fit-width', // 'fit-width' | 'fit-height'
    },

    // --- NAVIGATION MANAGER ---
    navigation: {
        pushState() {
            const viewer = document.getElementById('viewer');
            let scrollTop = viewer.scrollTop;
            let scrollLeft = viewer.scrollLeft;
            let currentIdx = 0;

            if (Epubly.state.currentFormat === 'epub') {
                let firstVisibleChapter = document.querySelector('.chapter-container');
                if (firstVisibleChapter) currentIdx = parseInt(firstVisibleChapter.dataset.index) || 0;
            }
            
            Epubly.state.history.push({
                chapterIndex: currentIdx,
                scrollTop: scrollTop,
                scrollLeft: scrollLeft
            });
            Epubly.ui.showFloatingBackButton(false);
        },
        
        popState() {
            if(Epubly.state.history.length === 0) return;
            const state = Epubly.state.history.pop();
            Epubly.ui.showFloatingBackButton(false);
            
            if (Epubly.state.currentFormat === 'epub') {
                document.getElementById('viewer-content').innerHTML = '';
                Epubly.state.renderedChapters.clear();
                Epubly.engine.renderChapter(state.chapterIndex, 'clear').then(() => {
                    const viewer = document.getElementById('viewer');
                    setTimeout(() => {
                        viewer.scrollTop = state.scrollTop;
                        viewer.scrollLeft = state.scrollLeft || 0;
                    }, 50);
                });
            } else {
                // PDF Restore
                const viewer = document.getElementById('viewer');
                viewer.scrollTop = state.scrollTop;
            }
        },

        handleLinkClick(e) {
            const link = e.target.closest('a');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href) return;

            if (href.startsWith('http')) {
                e.preventDefault();
                window.open(href, '_blank');
                return;
            }

            e.preventDefault();
            this.pushState();

            // EPUB internal linking logic
            if (Epubly.state.currentFormat === 'epub') {
                const [path, hash] = href.split('#');
                const targetPath = Epubly.engine.resolvePath(Epubly.state.currentChapterPath, path);
                
                let targetIndex = Epubly.state.spine.findIndex(s => s.fullPath === targetPath);

                if (targetIndex !== -1) {
                    const isSameChapter = Array.from(Epubly.state.renderedChapters).includes(targetIndex);
                    if (isSameChapter && hash) {
                        this.scrollToHash(hash);
                    } else {
                        document.getElementById('viewer-content').innerHTML = '';
                        Epubly.state.renderedChapters.clear();
                        Epubly.engine.renderChapter(targetIndex, 'clear').then(() => {
                            if (hash) this.scrollToHash(hash);
                        });
                    }
                } else {
                    console.warn("Could not find target for:", href);
                }
            }
            Epubly.ui.showFloatingBackButton(true);
        },

        scrollToHash(hash) {
            if (!hash) return;
            setTimeout(() => {
                const target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        },

        // --- PAGED NAVIGATION ---
        turnPage(direction) {
            const viewer = document.getElementById('viewer');
            
            const pageWidth = viewer.clientWidth;
            const scrollWidth = viewer.scrollWidth;
            const currentScroll = Math.ceil(viewer.scrollLeft);
            
            if (direction === 'next') {
                // Ensure we don't scroll past the end
                if (currentScroll + pageWidth < scrollWidth - 10) { 
                    viewer.scrollBy({ left: pageWidth, behavior: 'smooth' });
                } else {
                    // End of chapter/content
                    if (Epubly.state.currentFormat === 'epub') {
                        const lastIdx = Math.max(...Epubly.state.renderedChapters);
                        if (lastIdx < Epubly.state.spine.length - 1) {
                            document.getElementById('viewer-content').innerHTML = '';
                            Epubly.state.renderedChapters.clear();
                            Epubly.engine.renderChapter(lastIdx + 1, 'clear').then(() => {
                                viewer.scrollLeft = 0;
                            });
                        }
                    }
                }
            } else { // prev
                if (currentScroll > 10) {
                    viewer.scrollBy({ left: -pageWidth, behavior: 'smooth' });
                } else {
                    // Start of chapter
                    if (Epubly.state.currentFormat === 'epub') {
                        const firstIdx = Math.min(...Epubly.state.renderedChapters);
                        if (firstIdx > 0) {
                            document.getElementById('viewer-content').innerHTML = '';
                            Epubly.state.renderedChapters.clear();
                            Epubly.engine.renderChapter(firstIdx - 1, 'clear').then(() => {
                                setTimeout(() => {
                                    viewer.scrollLeft = viewer.scrollWidth;
                                }, 100);
                            });
                        }
                    }
                }
            }
            
            setTimeout(Epubly.engine.updatePageCounts, 300);
        }
    },

    // --- ENGINE ---
    engine: {
        async loadBook(arrayBuffer, bookId, format = 'epub') {
            Epubly.ui.showLoader();
            
            // RESET STATE
            Object.assign(Epubly.state, {
                zip: null, pdfDoc: null, currentFormat: format,
                spine: [], manifest: {}, renderedChapters: new Set(),
                toc: [], rootPath: '', currentBookId: bookId, activeBookSessionStart: Date.now(),
                isLoadingNext: false, isLoadingPrev: false, history: []
            });
            Epubly.ui.showFloatingBackButton(false);
            if(Epubly.state.observer) Epubly.state.observer.disconnect();

            try {
                if (format === 'pdf') {
                    await this.loadPDF(arrayBuffer, bookId);
                } else {
                    await this.loadEPUB(arrayBuffer, bookId);
                }
                
                // Common Post-Load Logic
                document.getElementById('viewer').onscroll = this.handleNavigation.bind(this);
                window.onresize = this.updatePageCounts.bind(this);
                Epubly.ui.hideLoader();

            } catch (e) {
                console.error("Engine Error:", e);
                alert("Hiba: " + e.message);
                Epubly.ui.hideLoader();
                Epubly.ui.showLibraryView();
            }
        },

        async loadPDF(arrayBuffer, bookId) {
            if (!window.pdfjsLib) throw new Error("PDF motor nem található.");
            
            const loadingTask = pdfjsLib.getDocument(arrayBuffer);
            Epubly.state.pdfDoc = await loadingTask.promise;
            
            // Basic Metadata
            let title = "PDF Dokumentum";
            try {
                const meta = await Epubly.state.pdfDoc.getMetadata();
                if (meta.info.Title) title = meta.info.Title;
            } catch(e) {}
            
            Epubly.state.metadata = { title: title, author: "" };
            Epubly.ui.updateHeaderInfo(title, "", "");
            
            document.getElementById('viewer-content').innerHTML = '';
            Epubly.ui.showReaderView();
            
            // Show PDF Controls
            Epubly.ui.togglePDFControls(true);

            // Render Pages
            const viewerContent = document.getElementById('viewer-content');
            
            for (let pageNum = 1; pageNum <= Epubly.state.pdfDoc.numPages; pageNum++) {
                const page = await Epubly.state.pdfDoc.getPage(pageNum);
                
                const canvas = document.createElement('canvas');
                canvas.className = 'pdf-page';
                canvas.dataset.pageNumber = pageNum;
                
                // Render at high scale (2.0) for clarity when zooming
                // We use CSS to scale it down visually
                const scale = 2.0; 
                const viewport = page.getViewport({ scale: scale });

                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                // Default Layout CSS (fit-width)
                canvas.style.width = '100%';
                canvas.style.height = 'auto';

                // Click to zoom interaction
                canvas.onclick = (e) => {
                    e.target.classList.toggle('zoomed');
                };

                const renderContext = {
                    canvasContext: canvas.getContext('2d'),
                    viewport: viewport
                };
                
                await page.render(renderContext).promise;
                viewerContent.appendChild(canvas);
            }

            // Restore Position
            const savedLoc = Epubly.storage.getLocation(bookId);
            if(savedLoc) {
                const parts = savedLoc.split(',');
                const savedPos = parseInt(parts[1]) || 0;
                document.getElementById('viewer').scrollTop = savedPos;
            }
        },

        async loadEPUB(arrayBuffer, bookId) {
            Epubly.ui.togglePDFControls(false); // Hide PDF controls for EPUB
            
            if (!window.JSZip) throw new Error("JSZip hiányzik!");
            Epubly.state.zip = await JSZip.loadAsync(arrayBuffer);

            const containerXml = await Epubly.state.zip.file("META-INF/container.xml").async("string");
            const parser = new DOMParser();
            const containerDoc = parser.parseFromString(containerXml, "application/xml");
            const rootfile = containerDoc.querySelector("rootfile");
            if(!rootfile) throw new Error("Hibás EPUB: Nincs rootfile.");
            
            const fullOpfPath = rootfile.getAttribute("full-path");
            const lastSlash = fullOpfPath.lastIndexOf('/');
            Epubly.state.rootPath = lastSlash !== -1 ? fullOpfPath.substring(0, lastSlash + 1) : '';

            const opfXml = await Epubly.state.zip.file(fullOpfPath).async("string");
            const opfDoc = parser.parseFromString(opfXml, "application/xml");

            for (let item of opfDoc.getElementsByTagName("item")) {
                Epubly.state.manifest[item.getAttribute("id")] = {
                    href: item.getAttribute("href"),
                    type: item.getAttribute("media-type"),
                    fullPath: this.resolvePath(Epubly.state.rootPath, item.getAttribute("href"))
                };
            }

            for (let item of opfDoc.getElementsByTagName("itemref")) {
                const manifestItem = Epubly.state.manifest[item.getAttribute("idref")];
                if (manifestItem) {
                    Epubly.state.spine.push({
                        id: item.getAttribute("idref"),
                        href: manifestItem.href,
                        fullPath: manifestItem.fullPath
                    });
                }
            }

            const title = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || "Névtelen Könyv";
            const author = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || "Ismeretlen Szerző";
            Epubly.state.metadata = { title, author };
            
            Epubly.ui.updateHeaderInfo(title, author, "");

            // -- POSITION RESTORATION LOGIC --
            let startIdx = 0;
            let savedPos = 0;
            const savedLoc = Epubly.storage.getLocation(bookId);
            
            if(savedLoc) {
                const parts = savedLoc.split(',');
                const idx = parseInt(parts[0]);
                if(!isNaN(idx) && idx < Epubly.state.spine.length) startIdx = idx;
                savedPos = parseInt(parts[1]) || 0;
            }

            document.getElementById('viewer-content').innerHTML = '';
            Epubly.ui.showReaderView();
            
            await this.renderChapter(startIdx, 'clear');

            setTimeout(() => {
                const viewer = document.getElementById('viewer');
                if (Epubly.settings.get().viewMode === 'paged') {
                     viewer.scrollLeft = savedPos;
                } else {
                     viewer.scrollTop = savedPos;
                }
                this.updatePageCounts();
            }, 150); 
            
            this.initObservers();
            this.parseTOC(opfDoc);
        },

        async renderChapter(index, method = 'append') {
            if (index < 0 || index >= Epubly.state.spine.length) return;
            if (Epubly.state.renderedChapters.has(index) && method !== 'clear') return;

            const chapterItem = Epubly.state.spine[index];
            Epubly.state.currentChapterPath = chapterItem.fullPath;
            const file = Epubly.state.zip.file(chapterItem.fullPath);
            if (!file) return;

            let htmlContent = await file.async("string");
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, "text/html");

            doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());
            doc.querySelectorAll('*').forEach(el => { el.removeAttribute('style'); el.removeAttribute('class'); });

            const images = doc.querySelectorAll("img, image");
            for (const img of images) {
                const src = img.getAttribute("src") || img.getAttribute("href") || img.getAttribute("xlink:href");
                if (!src) continue;
                const resolvedPath = this.resolvePath(chapterItem.fullPath.substring(0, chapterItem.fullPath.lastIndexOf('/') + 1), src);
                const imgFile = Epubly.state.zip.file(resolvedPath);
                if (imgFile) {
                    const blob = await imgFile.async("blob");
                    const url = URL.createObjectURL(blob);
                    img.src = url;
                    if(img.tagName.toLowerCase() === 'image') {
                        img.setAttribute('href', url);
                    }
                }
            }

            const chapterContainer = document.createElement('div');
            chapterContainer.className = 'chapter-container';
            chapterContainer.dataset.index = index;
            chapterContainer.innerHTML = doc.body ? doc.body.innerHTML : "Hiba a fejezet megjelenítésekor.";
            chapterContainer.addEventListener('click', (e) => Epubly.navigation.handleLinkClick(e));

            const viewer = document.getElementById('viewer-content');
            if (method === 'clear') viewer.innerHTML = '';
            
            if (method === 'prepend') viewer.insertBefore(chapterContainer, viewer.firstChild);
            else viewer.appendChild(chapterContainer);

            Epubly.state.renderedChapters.add(index);
            Epubly.reader.applySettings(Epubly.settings.get());
            
            setTimeout(this.updatePageCounts, 100);
        },

        resolvePath(base, relative) {
            if (!base || !relative) return relative;
            const stack = base.split("/");
            stack.pop();
            relative.split("/").forEach(part => {
                if (part === ".") return;
                if (part === "..") stack.pop();
                else stack.push(part);
            });
            return stack.join("/");
        },

        initObservers() {
            if (Epubly.settings.get().viewMode === 'paged') return;

            Epubly.state.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const idx = parseInt(entry.target.dataset.index);
                        const scrollTop = document.getElementById('viewer').scrollTop;
                        // Only save chapter index for EPUBs here.
                        if (Epubly.state.currentFormat === 'epub') {
                            Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, scrollTop);
                            
                            const hTag = entry.target.querySelector('h1, h2, h3');
                            const chapterName = (hTag && hTag.innerText.length < 50) ? hTag.innerText : `Fejezet ${idx + 1}`;
                            Epubly.ui.updateHeaderInfo(Epubly.state.metadata.title, Epubly.state.metadata.author, chapterName);
                            Epubly.toc.highlight(idx);
                        }
                    }
                });
            }, { root: document.getElementById('viewer'), threshold: 0.1 });

            document.querySelectorAll('.chapter-container').forEach(el => Epubly.state.observer.observe(el));
        },

        handleNavigation() {
            const viewer = document.getElementById('viewer');
            const settings = Epubly.settings.get();
            
            // Universal Position Saver (works for PDF scroll too)
            // For EPUB paged mode, we save scrollLeft logic separately below.
            
            if (settings.viewMode === 'scroll') {
                 // Classic Scroll Logic for EPUB Infinite Scroll
                 if (Epubly.state.currentFormat === 'epub') {
                    if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 600 && !Epubly.state.isLoadingNext) {
                        const lastIdx = Math.max(...Epubly.state.renderedChapters);
                        if (lastIdx < Epubly.state.spine.length - 1) {
                            Epubly.state.isLoadingNext = true;
                            document.getElementById('scroll-loader').style.display = 'block';
                            this.renderChapter(lastIdx + 1, 'append').then(() => {
                                 document.getElementById('scroll-loader').style.display = 'none';
                                 Epubly.state.isLoadingNext = false;
                            });
                        }
                    }
                    // Update position
                    const firstChapter = document.querySelector('.chapter-container');
                    if(firstChapter) {
                         const idx = parseInt(firstChapter.dataset.index);
                         Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, viewer.scrollTop);
                    }
                 } else {
                     // PDF Scroll Position
                     Epubly.storage.saveLocation(Epubly.state.currentBookId, 0, viewer.scrollTop);
                 }
            } else {
                // Paged Mode
                this.updatePageCounts();
                if (Epubly.state.currentFormat === 'epub') {
                    const currentChapterIdx = Math.max(...Epubly.state.renderedChapters);
                    Epubly.storage.saveLocation(Epubly.state.currentBookId, currentChapterIdx, viewer.scrollLeft);
                } else {
                     // PDF Paged (if forced) - Treat as scroll
                     Epubly.storage.saveLocation(Epubly.state.currentBookId, 0, viewer.scrollTop);
                }
            }
        },

        updatePageCounts() {
            const viewer = document.getElementById('viewer');
            if(Epubly.settings.get().viewMode !== 'paged' || Epubly.state.currentFormat !== 'epub') {
                document.getElementById('header-page').textContent = "";
                return;
            }

            const totalWidth = viewer.scrollWidth;
            const viewWidth = viewer.clientWidth;
            const currentPos = viewer.scrollLeft;

            const totalPages = Math.ceil(totalWidth / viewWidth);
            const currentPage = Math.round(currentPos / viewWidth) + 1;

            document.getElementById('header-page').textContent = `${currentPage} / ${totalPages}`;
        },

        async parseTOC(opfDoc) {
            let tocPath = "";
            const tocId = opfDoc.querySelector("spine")?.getAttribute("toc");
            if(tocId && Epubly.state.manifest[tocId]) {
                tocPath = Epubly.state.manifest[tocId].fullPath;
            } else {
                const key = Object.keys(Epubly.state.manifest).find(k => Epubly.state.manifest[k].href.includes("toc"));
                if (key) tocPath = Epubly.state.manifest[key].fullPath;
            }
            if(!tocPath) { Epubly.toc.generate([]); return; }

            try {
                const tocXml = await Epubly.state.zip.file(tocPath).async("string");
                const tocDoc = new DOMParser().parseFromString(tocXml, "application/xml");
                const tocItems = Array.from(tocDoc.querySelectorAll("navPoint")).map(point => {
                    const label = point.querySelector("text")?.textContent;
                    const content = point.querySelector("content")?.getAttribute("src");
                    if (!label || !content) return null;
                    const fullHref = this.resolvePath(tocPath.substring(0, tocPath.lastIndexOf('/') + 1), content.split('#')[0]);
                    const spineIdx = Epubly.state.spine.findIndex(s => s.fullPath === fullHref);
                    return spineIdx !== -1 ? { label, index: spineIdx } : null;
                }).filter(Boolean);
                Epubly.toc.generate(tocItems);
            } catch(e) { console.warn("TOC Error", e); Epubly.toc.generate([]); }
        }
    },

    // --- SEARCH ---
    search: {
        async run(query) {
            if(Epubly.state.currentFormat !== 'epub') {
                alert("A keresés jelenleg csak EPUB könyveknél érhető el.");
                return;
            }
            if(!Epubly.state.zip || !query || query.length < 3) return;
            const resultsDiv = document.getElementById('search-results');
            const progress = document.getElementById('search-progress');
            document.getElementById('search-status').style.display = 'block';
            resultsDiv.innerHTML = '';
            
            const q = query.toLowerCase();
            let count = 0;
            for (let i = 0; i < Epubly.state.spine.length; i++) {
                progress.textContent = `${Math.round((i/Epubly.state.spine.length)*100)}%`;
                const file = Epubly.state.zip.file(Epubly.state.spine[i].fullPath);
                if(file) {
                    const text = (await file.async("string")).replace(/<[^>]*>/g, ' '); 
                    if(text.toLowerCase().includes(q)) {
                        count++;
                        const snippet = text.substring(Math.max(0, text.toLowerCase().indexOf(q) - 40), text.toLowerCase().indexOf(q) + 40);
                        const item = document.createElement('div');
                        item.className = 'search-result-item';
                        item.innerHTML = `
                            <div style="font-weight:bold; font-size:0.8rem; color:var(--brand);">Fejezet ${i + 1}</div>
                            <div style="font-size:0.9rem; color:var(--text-muted);">...${snippet.replace(new RegExp(query, 'gi'), m => `<span class="hl-yellow">${m}</span>`)}...</div>
                        `;
                        item.onclick = () => {
                            Epubly.ui.hideModal('search-modal');
                            document.getElementById('viewer-content').innerHTML = '';
                            Epubly.state.renderedChapters.clear();
                            Epubly.engine.renderChapter(i, 'clear');
                        };
                        resultsDiv.appendChild(item);
                        if(count > 50) break; 
                    }
                }
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
            const viewer = document.getElementById('viewer-content');
            if(box && img && viewer) {
                viewer.addEventListener('click', e => {
                    if(e.target.tagName === 'IMG') {
                        img.src = e.target.src;
                        box.classList.add('visible');
                    }
                });
                const hide = () => box.classList.remove('visible');
                box.querySelector('.lightbox-close').onclick = hide;
                box.onclick = e => { if(e.target === box) hide(); };
            }
        }
    },

    // --- READER SETTINGS ---
    reader: {
        updateSessionStats() {
            if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
            const now = Date.now();
            const duration = now - Epubly.state.activeBookSessionStart;
            Epubly.state.activeBookSessionStart = now;
            
            const progress = 0; // Simplified
            Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, progress);
        },
        applySettings(settings) {
            const viewer = document.getElementById('viewer-content');
            if(!viewer) return;
            
            // GLOBAL ZOOM CALCULATION
            const zoom = settings.globalZoom || 1.0;
            
            // MARGIN LOGIC
            let paddingLeft, paddingRight;
            
            if (settings.viewMode === 'paged') {
                const pagedMargin = settings.marginPaged || 0;
                paddingLeft = `${pagedMargin}%`;
                paddingRight = `${pagedMargin}%`;
            } else {
                const scrollMargin = settings.marginScroll || 10;
                paddingLeft = `${scrollMargin}%`;
                paddingRight = `${scrollMargin}%`;
            }
            
            const verticalMargin = settings.marginVertical || 60;

            Object.assign(viewer.style, {
                fontFamily: settings.fontFamily,
                // Scale Font Size by Global Zoom
                fontSize: `${settings.fontSize * zoom}%`,
                lineHeight: settings.lineHeight, // Keeps ratio, effectively scales with font size
                textAlign: settings.textAlign,
                fontWeight: settings.fontWeight,
                color: settings.fontColor,
                // Scale Letter Spacing by Global Zoom (if it was px based, which it is)
                letterSpacing: `${settings.letterSpacing * zoom}px`,
                paddingLeft: paddingLeft,
                paddingRight: paddingRight,
                paddingTop: `${verticalMargin}px`,
                paddingBottom: `${verticalMargin}px`
            });
            
            document.body.className = `theme-${settings.theme}`;
            if (settings.theme === 'terminal') {
                document.body.style.setProperty('--terminal-color', settings.terminalColor);
            }

            // Handle View Mode Class
            document.body.classList.remove('view-mode-scroll', 'view-mode-paged', 'double-page');
            document.body.classList.add(`view-mode-${settings.viewMode}`);
            
            // Update UI Slider Visibility based on Mode
            const scrollControl = document.getElementById('margin-scroll-control');
            const pagedControl = document.getElementById('margin-paged-control');
            const verticalControl = document.getElementById('margin-vertical-control');

            if (settings.viewMode === 'paged') {
                if (scrollControl) scrollControl.style.display = 'none';
                if (pagedControl) pagedControl.style.display = 'block';
                if (verticalControl) verticalControl.style.display = 'block';
            } else {
                if (scrollControl) scrollControl.style.display = 'block';
                if (pagedControl) pagedControl.style.display = 'none';
                if (verticalControl) verticalControl.style.display = 'none';
            }

            Epubly.engine.updatePageCounts();
        }
    },

    toc: {
        generate(tocItems) {
            const tocList = document.getElementById('toc-list');
            if(!tocList) return;
            tocList.innerHTML = !tocItems || tocItems.length === 0 
                ? '<li><span style="color:var(--text-muted); padding:8px; display:block;">Nincs tartalomjegyzék.</span></li>'
                : tocItems.map(item => `<li><a class="toc-link" data-idx="${item.index}">${item.label || "Fejezet " + (item.index + 1)}</a></li>`).join('');
            
            tocList.querySelectorAll('.toc-link').forEach(link => {
                link.onclick = () => {
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(parseInt(link.dataset.idx), 'clear');
                };
            });
        },
        highlight(idx) {
            document.querySelectorAll('.toc-link').forEach(el => {
                el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
            });
        }
    },

    settings: {
        init() {
            this.load();
            const bind = (id, event, key) => {
                const el = document.getElementById(id);
                if(el) el.addEventListener(event, e => this.handleUpdate(key, e.target.value));
            };
            bind('font-size-range', 'input', 'fontSize');
            bind('line-height-range', 'input', 'lineHeight');
            // Bind Separate Margin Controls
            bind('margin-scroll-range', 'input', 'marginScroll');
            bind('margin-paged-range', 'input', 'marginPaged');
            bind('margin-vertical-range', 'input', 'marginVertical'); 
            
            // New Global Zoom
            bind('global-zoom-range', 'input', 'globalZoom');

            bind('font-weight-range', 'input', 'fontWeight');
            bind('letter-spacing-range', 'input', 'letterSpacing');
            bind('font-color-picker', 'input', 'fontColor');
            bind('terminal-color-picker', 'input', 'terminalColor');
            bind('font-family-select', 'change', 'fontFamily');
            
            ['align-toggle-group', 'theme-toggle-group', 'view-mode-toggle-group'].forEach(id => {
                document.getElementById(id)?.querySelectorAll('.toggle-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const key = id.includes('align') ? 'textAlign' : (id.includes('theme') ? 'theme' : 'viewMode');
                        this.handleUpdate(key, btn.dataset.val);
                    });
                });
            });

            // Terminal Presets
            document.querySelectorAll('.color-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const color = btn.dataset.color;
                    const picker = document.getElementById('terminal-color-picker');
                    if(picker) picker.value = color;
                    this.handleUpdate('terminalColor', color);
                });
            });
        },
        get() {
            const defaults = {
                globalZoom: '1.0', // NEW
                fontSize: '100', lineHeight: '1.6', 
                marginScroll: '28', // Default 70% of 40
                marginPaged: '0',   
                marginVertical: '60', 
                textAlign: 'left', fontFamily: "'Inter', sans-serif",
                fontWeight: '400', letterSpacing: '0', fontColor: 'var(--text)',
                theme: 'dark', terminalColor: '#00FF41',
                viewMode: 'scroll' // Default to scroll
            };
            try {
                const saved = JSON.parse(localStorage.getItem('epubly-settings'));
                return { ...defaults, ...saved };
            } catch {
                return defaults;
            }
        },
        save(settings) { localStorage.setItem('epubly-settings', JSON.stringify(settings)); },
        load() {
            const s = this.get();
            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
            setVal('font-size-range', s.fontSize);
            setVal('line-height-range', s.lineHeight);
            setVal('margin-scroll-range', s.marginScroll);
            setVal('margin-paged-range', s.marginPaged);
            setVal('margin-vertical-range', s.marginVertical);
            setVal('font-weight-range', s.fontWeight);
            setVal('letter-spacing-range', s.letterSpacing);
            setVal('font-color-picker', s.fontColor);
            setVal('terminal-color-picker', s.terminalColor);
            setVal('font-family-select', s.fontFamily);
            setVal('global-zoom-range', s.globalZoom);
            
            const updateToggle = (groupId, val) => {
                document.getElementById(groupId)?.querySelectorAll('.toggle-btn').forEach(b => { 
                    b.classList.toggle('active', b.dataset.val === val); 
                });
            };
            updateToggle('align-toggle-group', s.textAlign);
            updateToggle('theme-toggle-group', s.theme);
            updateToggle('view-mode-toggle-group', s.viewMode);
            
            const terminalOpts = document.getElementById('terminal-options');
            if (terminalOpts) {
                terminalOpts.style.display = s.theme === 'terminal' ? 'block' : 'none';
            }

            Epubly.reader.applySettings(s);
        },
        handleUpdate(key, value) {
            const s = this.get();
            s[key] = value;
            if (key === 'theme') {
                s.fontColor = (value === 'light' || value === 'sepia') ? '#1C1C1E' : '#F2F2F7';
            }
            this.save(s);
            this.load(); 
        }
    },

    storage: {
        db: null, // Lazily initialized
        async getDb() {
            if (this.db) return this.db;
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('EpublyDB', 4);
                request.onerror = () => reject("IndexedDB error");
                request.onblocked = () => reject("Az adatbázis zárolva van. Kérjük, zárja be az alkalmazás többi példányát, majd frissítse az oldalt.");
                request.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
                request.onupgradeneeded = e => {
                    if (!e.target.result.objectStoreNames.contains('books')) {
                        e.target.result.createObjectStore('books', { keyPath: 'id' });
                    }
                }
            });
        },
        async transaction(storeName, mode, callback) {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                callback(store, resolve, reject);
            });
        },
        async saveBook(bookRecord) {
            return this.transaction('books', 'readwrite', (store, res, rej) => {
                const req = store.put(bookRecord);
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
        },
        async getBook(id) {
             return this.transaction('books', 'readonly', (store, res, rej) => {
                const req = store.get(id);
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
        },
        async getAllBooks() {
            return this.transaction('books', 'readonly', (store, res, rej) => {
                const req = store.getAll();
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
        },
        async deleteBook(id) {
            localStorage.removeItem(`epubly-loc-${id}`);
            localStorage.removeItem(`epubly-highlights-${id}`);
            return this.transaction('books', 'readwrite', (s, res, rej) => { s.delete(id).onsuccess = res; });
        },
        async clearBooks() {
            return this.transaction('books', 'readwrite', (s, res, rej) => { s.clear().onsuccess = res; });
        },
        async handleFileUpload(file) {
            Epubly.ui.showLoader();
            Epubly.ui.hideModal('import-modal');
            try {
                // Strict File Validation
                const allowedExtensions = ['.epub', '.pdf'];
                const fileName = file.name.toLowerCase();
                const isValid = allowedExtensions.some(ext => fileName.endsWith(ext));
                
                if (!isValid) {
                    throw new Error("Nem támogatott fájlformátum. Kérjük, csak .epub vagy .pdf fájlokat tölts fel.");
                }

                const arrayBuffer = await file.arrayBuffer();
                let metadata = { title: file.name, creator: "Ismeretlen" };
                let coverUrl = null;
                
                // DETECT FORMAT
                let format = 'epub';
                if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
                    format = 'pdf';
                    metadata.title = file.name.replace('.pdf', '');
                    metadata.creator = "PDF Dokumentum";
                    
                    // Generate PDF Thumbnail
                    try {
                        const pdfTask = pdfjsLib.getDocument(arrayBuffer.slice(0)); // Clone buffer for metadata op
                        const pdf = await pdfTask.promise;
                        const page = await pdf.getPage(1);
                        const viewport = page.getViewport({ scale: 0.5 }); // Thumbnail scale
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const ctx = canvas.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport }).promise;
                        coverUrl = canvas.toDataURL();
                        
                        // Try to get internal title
                        try {
                            const meta = await pdf.getMetadata();
                            if (meta.info.Title) metadata.title = meta.info.Title;
                        } catch(e){}
                        
                    } catch(e) {
                        console.warn("PDF Thumbnail failed", e);
                    }

                } else {
                    // EPUB Metadata Extraction
                    const zip = await JSZip.loadAsync(arrayBuffer);
                    const containerXml = await zip.file("META-INF/container.xml").async("string");
                    const opfPath = new DOMParser().parseFromString(containerXml, "application/xml").querySelector("rootfile").getAttribute("full-path");
                    const opfDoc = new DOMParser().parseFromString(await zip.file(opfPath).async("string"), "application/xml");
                    metadata.title = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || file.name;
                    metadata.creator = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || "";
                    
                    const coverItem = opfDoc.querySelector("item[properties~='cover-image'], item[id='cover']");
                    if (coverItem) {
                        const href = Epubly.engine.resolvePath(opfPath, coverItem.getAttribute("href"));
                        const coverFile = zip.file(href);
                        if(coverFile) coverUrl = URL.createObjectURL(await coverFile.async("blob"));
                    }
                }
                
                // SAVE
                const bookId = `${Date.now()}`;
                await this.saveBook({
                    id: bookId, 
                    data: arrayBuffer, 
                    format: format, // Store format!
                    metadata: {...metadata, coverUrl},
                    stats: { totalTime: 0, progress: 0, lastRead: Date.now() }
                });
                await Epubly.library.render();
                Epubly.ui.hideLoader();
                
            } catch (error) {
                console.error(error);
                alert("Hiba: " + error.message);
                Epubly.ui.hideLoader();
            }
        },
        async updateBookStats(bookId, durationDelta, percentage) {
            const book = await this.getBook(bookId);
            if(book) {
                book.stats = book.stats || { totalTime: 0, progress: 0, lastRead: Date.now() };
                if(durationDelta > 0 && durationDelta < 86400000) book.stats.totalTime += durationDelta;
                book.stats.progress = Math.max(book.stats.progress || 0, percentage);
                book.stats.lastRead = Date.now();
                await this.saveBook(book);
            }
        },
        getLocation(bookId) { return localStorage.getItem(`epubly-loc-${bookId}`); },
        saveLocation(bookId, idx, scroll) { localStorage.setItem(`epubly-loc-${bookId}`, `${idx},${Math.round(scroll)}`); }
    },

    library: {
        generateCover(title, author) {
            // Procedural cover generation based on title string hash
            let hash = 0;
            const str = title + author;
            for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
            
            // Generate pastel colors
            const h = Math.abs(hash) % 360;
            const c1 = `hsl(${h}, 70%, 80%)`;
            const c2 = `hsl(${(h + 40) % 360}, 70%, 70%)`;
            
            const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
                <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="${c1}"/>
                        <stop offset="100%" stop-color="${c2}"/>
                    </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill="url(#g)"/>
                <text x="50%" y="45%" fill="#333" font-family="Georgia, serif" font-size="28" font-weight="bold" text-anchor="middle">
                    ${title.substring(0, 30)}${title.length>30?'...':''}
                </text>
                <text x="50%" y="60%" fill="#555" font-family="sans-serif" font-size="16" text-anchor="middle">
                    ${author.substring(0, 25)}
                </text>
            </svg>`;
            return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
        },
        async render() {
            const grid = document.getElementById('library-grid');
            if(!grid) return;
            grid.innerHTML = '';
            
            // Inject Import Card FIRST with Drag & Drop events
            const importCard = document.createElement('div');
            importCard.className = 'import-card';
            importCard.onclick = () => Epubly.ui.showModal('import-modal');
            
            // Attach Drag events
            ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
                importCard.addEventListener(eventName, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });

            importCard.addEventListener('dragenter', () => importCard.classList.add('drag-active'));
            importCard.addEventListener('dragover', () => importCard.classList.add('drag-active'));
            importCard.addEventListener('dragleave', () => importCard.classList.remove('drag-active'));
            importCard.addEventListener('drop', (e) => {
                importCard.classList.remove('drag-active');
                if (e.dataTransfer.files.length > 0) {
                    Epubly.storage.handleFileUpload(e.dataTransfer.files[0]);
                }
            });

            importCard.innerHTML = `
                <div class="book-cover">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                </div>
                <div class="book-title" style="text-align:center;">Új Könyv</div>
                <div class="book-author" style="text-align:center;">Importálás</div>
            `;
            grid.appendChild(importCard);

            const books = await Epubly.storage.getAllBooks();
            
            books.sort((a,b) => (b.stats?.lastRead || 0) - (a.stats?.lastRead || 0)).forEach(book => {
                const card = document.createElement('div');
                card.className = 'book-card';
                // RESTORED: Direct onclick handler for reliability (v0.13.1 style)
                // Passes the entire book object to avoid async fetching delays
                card.onclick = () => Epubly.ui.showBookInfoModal(book);
                
                const coverSrc = book.metadata.coverUrl || this.generateCover(book.metadata.title, book.metadata.creator);
                
                card.innerHTML = `
                    <div class="book-cover"><img src="${coverSrc}" alt="${book.metadata.title}" loading="lazy"></div>
                    <div class="book-title" title="${book.metadata.title}">${book.metadata.title || "Ismeretlen"}</div>
                    <div class="book-author" title="${book.metadata.creator}">${book.metadata.creator || "Ismeretlen"}</div>
                `;
                grid.appendChild(card);
            });
        }
    },
    
    ui: {
        init() {
            // Fix for File Import Input
            const fileInput = document.getElementById('epub-file');
            if(fileInput) {
                fileInput.addEventListener('change', (e) => {
                    if(e.target.files.length > 0) Epubly.storage.handleFileUpload(e.target.files[0]);
                });
            }

            // Event listeners
            document.body.addEventListener('click', e => {
                const target = e.target;
                const closest = (selector) => target.closest(selector);
                
                // PDF Control Buttons
                if (closest('.pdf-btn')) {
                    const action = closest('.pdf-btn').dataset.action;
                    this.handlePDFControl(action);
                }

                // Paged Navigation Click Zones
                if (target.id === 'nav-zone-left') Epubly.navigation.turnPage('prev');
                if (target.id === 'nav-zone-right') Epubly.navigation.turnPage('next');
                
                // Generic sidebar closer logic
                if (!closest('.sidebar') && !closest('.toggle-sidebar-btn')) {
                    document.querySelectorAll('.sidebar.visible').forEach(sb => sb.classList.remove('visible'));
                }
                
                if (closest('.close-sidebar')) Epubly.ui.toggleSidebar(closest('.close-sidebar').dataset.target);
                if (closest('.sidebar-tab')) this.handleTabClick(target);
                
                // Wiki Navigation
                if (closest('.wiki-nav-btn')) {
                    const btn = closest('.wiki-nav-btn');
                    const targetId = btn.dataset.target;
                    document.querySelectorAll('.wiki-nav-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    document.querySelectorAll('.wiki-page').forEach(p => p.classList.remove('active'));
                    document.getElementById(targetId).classList.add('active');
                }

                if (closest('#app-logo-btn')) { Epubly.reader.updateSessionStats(); Epubly.ui.showLibraryView(); }
                if (closest('.modal-close')) closest('.modal').classList.remove('visible');
                if (target.classList.contains('modal')) target.classList.remove('visible');
                
                if (closest('#btn-do-search')) Epubly.search.run(document.getElementById('search-input').value);
                if (closest('#btn-theme-toggle')) this.toggleTheme();
                
                if (closest('#btn-delete-all') && confirm("FIGYELEM! Ez a gomb töröl minden könyvet, jegyzetet és beállítást. A művelet nem vonható vissza. Folytatod?")) {
                    localStorage.clear();
                    Epubly.storage.clearBooks().then(() => location.reload());
                }
                if (closest('#floating-back-btn')) Epubly.navigation.popState();
            });

            // Drag & Drop
            const dropZone = document.getElementById('import-drop-zone');
             if(dropZone) {
                ['dragover', 'dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.toggle('dragover', ev === 'dragover');
                    if (ev === 'drop') Epubly.storage.handleFileUpload(e.dataTransfer.files[0]);
                }));
            }
            
            // Inject Static QR for https://epubly.hu
            this.injectQRCode();
            
            const footer = document.getElementById('footer-year');
            if(footer) footer.textContent = `Epubly.hu v${version} © ${new Date().getFullYear()}`;
        },

        handleTabClick(tab) {
            const container = tab.closest('.modal-content, .sidebar');
            if(!container) return;
            container.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.sidebar-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const targetPane = container.querySelector(`#${tab.dataset.tab}`);
            if(targetPane) targetPane.classList.add('active');
        },
        
        toggleTheme() {
            const s = Epubly.settings.get();
            // User Request: Only toggle between Dark and Sepia via button
            const nextTheme = s.theme === 'dark' ? 'sepia' : 'dark';
            Epubly.settings.handleUpdate('theme', nextTheme);
            this.updateThemeIcons(nextTheme);
        },

        updateThemeIcons(theme) {
            const sun = document.getElementById('theme-icon-sun');
            const moon = document.getElementById('theme-icon-moon');
            if(sun && moon) {
                // Logic: 
                // If Dark -> Show Sun (to indicate you can switch to a lighter mode i.e. Sepia)
                // If Sepia -> Show Moon (to indicate you can switch to dark)
                // For simplicity, treat 'sepia' like 'light'
                if (theme === 'sepia' || theme === 'light') {
                    sun.style.display = 'none';
                    moon.style.display = 'block';
                } else {
                    sun.style.display = 'block';
                    moon.style.display = 'none';
                }
            }
        },

        toggleSidebar(id) {
            const sidebar = document.getElementById(id);
            if(sidebar) {
                // If opening, close others
                if(!sidebar.classList.contains('visible')) {
                    document.querySelectorAll('.sidebar.visible').forEach(sb => sb.classList.remove('visible'));
                }
                sidebar.classList.toggle('visible');
            }
        },

        showModal(id) { document.getElementById(id)?.classList.add('visible'); },
        hideModal(id) { document.getElementById(id)?.classList.remove('visible'); },
        
        showLoader() { document.getElementById('loader')?.classList.remove('hidden'); },
        hideLoader() { document.getElementById('loader')?.classList.add('hidden'); },
        
        updateHeaderInfo(title, author, chapter) {
            const set = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
            set('header-author', author || "");
            set('header-title', title || "");
            set('header-chapter', ""); // Disabled by user request
            const sep = document.querySelector('.info-sep');
            if(sep) sep.style.display = author ? 'inline' : 'none';
        },
        
        showFloatingBackButton(visible) {
            document.getElementById('floating-back-btn-container')?.classList.toggle('visible', visible);
        },
        
        togglePDFControls(show) {
            const el = document.getElementById('pdf-controls');
            if (el) el.style.display = show ? 'flex' : 'none';
        },

        handlePDFControl(action) {
            const pages = document.querySelectorAll('.pdf-page');
            
            if (action === 'fit-width') {
                pages.forEach(p => { 
                    p.classList.remove('zoomed'); 
                    p.style.width = '100%'; 
                    p.style.height = 'auto'; 
                });
            } else if (action === 'fit-height') {
                pages.forEach(p => { 
                    p.classList.remove('zoomed'); 
                    p.style.height = '90vh'; 
                    p.style.width = 'auto'; 
                    p.style.maxWidth = 'none';
                    p.style.margin = '20px auto';
                });
            } else if (action === 'zoom-in') {
                pages.forEach(p => p.classList.add('zoomed'));
            } else if (action === 'zoom-out') {
                pages.forEach(p => p.classList.remove('zoomed'));
            }
        },
        
        showReaderView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('reader-view')?.classList.add('active');
            
            const actions = document.getElementById('top-actions-container');
            if(actions) {
                actions.innerHTML = `
                    <button class="icon-btn" onclick="Epubly.ui.showModal('search-modal')" title="Keresés"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor"/></svg></button>
                    <button class="icon-btn toggle-sidebar-btn" onclick="Epubly.ui.toggleSidebar('sidebar-toc')" title="Navigáció"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"/></svg></button>
                    <button class="icon-btn toggle-sidebar-btn" onclick="Epubly.ui.toggleSidebar('sidebar-settings')" title="Beállítások"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" fill="currentColor"/></svg></button>
                `;
            }
        },
        showLibraryView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('library-view')?.classList.add('active');
            this.updateHeaderInfo("Könyvtár", "", "");
            this.showFloatingBackButton(false);
            this.togglePDFControls(false); // Ensure hidden
            const actions = document.getElementById('top-actions-container');
            // Remove the import button from top actions, as it's now a card
            if(actions) actions.innerHTML = ``;
            Epubly.library.render();
        },
        showBookInfoModal(bookOrId) {
            // BACKWARD COMPATIBILITY FIX: 
            // Handle both full Book object (sync, fast) or ID (async, slow)
            // This restores v0.13.1 behavior where passing the object opened it instantly
            
            let book;
            if (typeof bookOrId === 'object') {
                book = bookOrId;
                this._renderBookInfoModal(book);
            } else {
                // Fallback for ID based calls (if any remain)
                Epubly.storage.getBook(bookOrId).then(b => {
                    if(b) this._renderBookInfoModal(b);
                });
            }
        },
        _renderBookInfoModal(book) {
            const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            const img = document.getElementById('detail-cover-img');
            // Use procedural cover if null
            if(img) img.src = book.metadata.coverUrl || Epubly.library.generateCover(book.metadata.title, book.metadata.creator);
            
            set('detail-title', book.metadata.title);
            set('detail-author', book.metadata.creator);
            const desc = document.getElementById('detail-desc');
            if(desc) {
                if (book.metadata.description) {
                    // Strip styles to ensure it matches app theme (no white backgrounds from inline styles)
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(book.metadata.description, 'text/html');
                    doc.body.querySelectorAll('*').forEach(el => {
                        el.removeAttribute('style');
                        el.removeAttribute('class');
                        el.removeAttribute('color');
                        el.removeAttribute('face');
                    });
                    desc.innerHTML = doc.body.innerHTML;
                } else {
                    desc.innerHTML = "Leírás nem elérhető.";
                }
            }
            
            const stats = book.stats || { totalTime: 0, progress: 0 };
            const minutes = Math.floor(stats.totalTime / 60000);
            set('detail-stats-time', `${Math.floor(minutes/60)}ó ${minutes%60}p`);
            set('detail-stats-prog', `${Math.round((stats.progress || 0) * 100)}%`);
            
            const readBtn = document.getElementById('btn-read-book');
            readBtn.textContent = stats.progress > 0.01 ? 'FOLYTATÁS' : 'OLVASÁS';
            
            // Re-bind actions with book object
            document.getElementById('btn-read-book').onclick = () => { this.hideModal('book-details-modal'); Epubly.engine.loadBook(book.data, book.id, book.format); };
            // Note: TOC button removed from HTML in previous versions? If needed check HTML. 
            // Kept logic safe if button is missing
            const btnToc = document.getElementById('btn-show-toc');
            if(btnToc) btnToc.onclick = async () => { this.hideModal('book-details-modal'); await Epubly.engine.loadBook(book.data, book.id, book.format); this.toggleSidebar('sidebar-toc'); };
            
            document.getElementById('btn-delete-book').onclick = async () => { 
                if(confirm('Biztosan törlöd?')) { 
                    await Epubly.storage.deleteBook(book.id); 
                    this.hideModal('book-details-modal'); 
                    // FIX: Force library view which triggers re-render, ensuring the deleted book is gone
                    this.showLibraryView(); 
                }
            };
            this.showModal('book-details-modal');
        },
        injectQRCode() {
            const containers = [
                { id: 'mohu-qr-container', size: 80 },
                { id: 'print-qr-container', size: 90 },
                { id: 'mobile-qr-target', size: 250 }
            ];
            
            // CSERÉLD KI EZT A SAJÁT EGYEDI KÓDODRA! (pl. "REpont-ABC-123")
            // Mivel az üzenetedben nem adtad meg a kódot, egy helyőrzőt használok.
            const mohuCode = "d0a663f6-b055-40e8-b3d5-399236cb6b94"; 

            containers.forEach(item => {
                const el = document.getElementById(item.id);
                // Ensure element exists and QRCode library is loaded
                if(el && window.QRCode) {
                    el.innerHTML = ''; // Clear previous content (static/base64)
                    try {
                        new QRCode(el, {
                            text: mohuCode,
                            width: item.size,
                            height: item.size,
                            colorDark : "#000000",
                            colorLight : "#ffffff",
                            correctLevel : QRCode.CorrectLevel.H
                        });
                    } catch (e) {
                        console.error("QR Generation failed:", e);
                        el.innerHTML = "QR Hiba";
                    }
                }
            });
        }
    },
    
    async init() {
        if (!window.JSZip) {
            throw new Error("A működéshez szükséges JSZip könyvtár nem töltődött be.");
        }
        if(!this.ui || !this.library || !this.settings || !this.storage) {
            throw new Error("Alkalmazás modulok hiányoznak. Az indítás sikertelen.");
        }

        this.ui.init();
        this.settings.init();
        this.lightbox.init();
        await this.storage.getDb();
        
        this.ui.showLibraryView();
        this.ui.hideLoader();
        
        console.log(`Epubly v${version} Initialized.`);
    }
};

window.Epubly = Epubly;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        await Epubly.init();
    } catch (error) {
        console.error("Fatal init error:", error);
        const loader = document.getElementById('loader');
        const errorDiv = document.getElementById('loader-error');
        const msgDiv = document.getElementById('loader-msg');
        const spinner = document.querySelector('#loader .spinner');
        const retryBtn = document.getElementById('retry-btn');
        
        if (loader) loader.classList.remove('hidden');
        if (errorDiv) {
            errorDiv.textContent = `Hiba történt az alkalmazás indításakor: ${error.message}`;
            errorDiv.style.display = 'block';
        }
        if (msgDiv) msgDiv.style.display = 'none';
        if (spinner) spinner.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'block';
    }
});
