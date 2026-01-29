
import { Utils } from './utils.js';

/**
 * Parsing & Rendering Engine
 */
export const Engine = {
    resolvePath: Utils.resolvePath,
    lastStatsSave: 0, 

    // PDF STATE
    pdfState: {
        scale: 1,
        panning: false,
        startX: 0,
        startY: 0,
        pointX: 0,
        pointY: 0,
        mode: 'native' // 'native' (scrolling) or 'custom' (transform)
    },

    async loadBook(arrayBuffer, bookId, format = 'epub') {
        Epubly.ui.showLoader();
        
        // RESET STATE
        Object.assign(Epubly.state, {
            zip: null, pdfDoc: null, currentFormat: format,
            spine: [], manifest: {}, renderedChapters: new Set(),
            toc: [], rootPath: '', currentBookId: bookId, activeBookSessionStart: Date.now(),
            isLoadingNext: false, isLoadingPrev: false, history: []
        });
        
        // Reset PDF State
        this.pdfState = { scale: 1, panning: false, startX: 0, startY: 0, pointX: 0, pointY: 0, mode: 'native' };

        Epubly.ui.showFloatingBackButton(false);
        if(Epubly.state.observer) Epubly.state.observer.disconnect();

        try {
            if (format === 'pdf') {
                await this.loadPDF(arrayBuffer, bookId);
            } else {
                await this.loadEPUB(arrayBuffer, bookId);
            }
            
            // Attach Scroll Saver (Immediate & Touch)
            const viewer = document.getElementById('viewer');
            viewer.onscroll = this.handleNavigation.bind(this);
            viewer.ontouchend = () => { this.saveCurrentPosition(true); };

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
        
        let title = "PDF Dokumentum";
        try {
            const meta = await Epubly.state.pdfDoc.getMetadata();
            if (meta.info.Title) title = meta.info.Title;
        } catch(e) {}
        
        Epubly.state.metadata = { title: title, author: "" };
        Epubly.ui.updateHeaderInfo(title, "", "");
        
        document.getElementById('viewer-content').innerHTML = '';
        Epubly.ui.showReaderView();
        Epubly.ui.togglePDFControls(true);

        const viewerContent = document.getElementById('viewer-content');
        
        // --- OPTIMIZATION: VIRTUALIZATION ---
        const page1 = await Epubly.state.pdfDoc.getPage(1);
        const viewport = page1.getViewport({ scale: 1.5 });
        const aspectRatio = viewport.width / viewport.height;
        
        for (let pageNum = 1; pageNum <= Epubly.state.pdfDoc.numPages; pageNum++) {
            const container = document.createElement('div');
            container.className = 'pdf-page-container';
            container.dataset.pageNumber = pageNum;
            container.style.aspectRatio = `${aspectRatio}`;
            container.style.width = '100%'; 
            viewerContent.appendChild(container);
        }

        this.initPDFObserver();

        const savedLoc = Epubly.storage.getLocation(bookId);
        if(savedLoc) {
            const parts = savedLoc.split(',');
            const savedPos = parseInt(parts[1]) || 0;
            // Stabilize scroll for PDF too
            this.stabilizeScroll(savedPos);
        }
        
        // Initial Render View
        this.renderPDFView();
    },

    initPDFObserver() {
        if (Epubly.state.observer) Epubly.state.observer.disconnect();
        Epubly.state.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const container = entry.target;
                    const pageNum = parseInt(container.dataset.pageNumber);
                    if (!container.querySelector('canvas')) this.renderPDFPage(container, pageNum);
                    
                    const progress = pageNum / Epubly.state.pdfDoc.numPages;
                    this.throttledStatsUpdate(pageNum, false, progress);
                    
                    if (this.pdfState.mode === 'native') {
                         const viewer = document.getElementById('viewer');
                         Epubly.storage.saveLocation(Epubly.state.currentBookId, 0, viewer.scrollTop);
                    }
                }
            });
        }, { root: document.getElementById('viewer'), rootMargin: "50% 0px" });
        document.querySelectorAll('.pdf-page-container').forEach(el => Epubly.state.observer.observe(el));
    },

    async renderPDFPage(container, pageNum) {
        if(!Epubly.state.pdfDoc) return;
        try {
            const page = await Epubly.state.pdfDoc.getPage(pageNum);
            const scale = 2.0; 
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            const renderContext = { canvasContext: canvas.getContext('2d'), viewport: viewport };
            await page.render(renderContext).promise;
            container.innerHTML = '';
            container.appendChild(canvas);
        } catch(e) { console.warn(`Error rendering page ${pageNum}`, e); }
    },

    // --- MODERN PDF TRANSFORM LOGIC ---
    updatePDFTransform(deltaScale, centerX, centerY) {
        const viewer = document.getElementById('viewer');
        if (this.pdfState.mode === 'native') {
            // Switch to custom mode on first zoom
            this.pdfState.mode = 'custom';
            this.pdfState.scale = 1;
            this.pdfState.pointX = 0;
            this.pdfState.pointY = -viewer.scrollTop; // compensate initial scroll
            viewer.classList.add('pdf-drag-mode');
        }

        const oldScale = this.pdfState.scale;
        let newScale = oldScale + deltaScale;
        newScale = Math.min(Math.max(0.5, newScale), 5); // Clamp

        // Simple zoom logic: zoom towards center of screen (simpler for vanilla)
        // Adjust translation to keep center stable would require complex math here.
        // For simplicity in this constraints: simple scale update. 
        // Improvement: If mouse coordinates provided (centerX/Y), zoom towards that.
        
        this.pdfState.scale = newScale;
        this.renderPDFView();
    },

    panPDF(deltaX, deltaY) {
        if (this.pdfState.mode !== 'custom') return;
        this.pdfState.pointX += deltaX;
        this.pdfState.pointY += deltaY;
        this.renderPDFView();
    },
    
    setPDFMode(mode) {
        this.pdfState.mode = mode;
        const viewer = document.getElementById('viewer');
        const content = document.getElementById('viewer-content');
        
        if (mode === 'native') {
            viewer.classList.remove('pdf-drag-mode');
            content.style.transform = '';
            this.pdfState.scale = 1;
            this.pdfState.pointX = 0;
            this.pdfState.pointY = 0;
            // Restore overflow
            viewer.style.overflow = 'auto';
        } else {
            viewer.classList.add('pdf-drag-mode');
            // Hide scrollbars
            viewer.style.overflow = 'hidden';
        }
    },

    renderPDFView() {
        const content = document.getElementById('viewer-content');
        if (this.pdfState.mode === 'custom') {
            content.style.transform = `translate(${this.pdfState.pointX}px, ${this.pdfState.pointY}px) scale(${this.pdfState.scale})`;
        } else {
            content.style.transform = '';
        }
    },

    async loadEPUB(arrayBuffer, bookId) {
        Epubly.ui.togglePDFControls(false); 
        
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
        await this.ensureContentFillsScreen(startIdx);

        // USE STABILIZATION instead of single set
        this.stabilizeScroll(savedPos);
        
        this.initObservers();
        this.parseTOC(opfDoc);
    },

    // --- SCROLL STABILIZATION LOOP ---
    stabilizeScroll(targetPos) {
        const viewer = document.getElementById('viewer');
        let attempts = 0;
        const maxAttempts = 10; // Check for 500ms approx
        
        const check = () => {
            viewer.scrollTop = targetPos;
            attempts++;
            if (attempts < maxAttempts) {
                requestAnimationFrame(check);
            }
        };
        requestAnimationFrame(check);
    },

    async ensureContentFillsScreen(lastLoadedIndex) {
        const viewer = document.getElementById('viewer');
        if (viewer.scrollHeight < viewer.clientHeight * 1.5 && lastLoadedIndex < Epubly.state.spine.length - 1) {
             const nextIdx = lastLoadedIndex + 1;
             await this.renderChapter(nextIdx, 'append');
             await this.ensureContentFillsScreen(nextIdx);
        }
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
    },

    initObservers() {
        if(Epubly.state.observer) Epubly.state.observer.disconnect();

        Epubly.state.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const idx = parseInt(entry.target.dataset.index);
                    const scrollTop = document.getElementById('viewer').scrollTop;
                    if (Epubly.state.currentFormat === 'epub') {
                        // Optimistically save on intersection
                        Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, scrollTop);
                        
                        const hTag = entry.target.querySelector('h1, h2, h3');
                        const chapterName = (hTag && hTag.innerText.length < 50) ? hTag.innerText : `Fejezet ${idx + 1}`;
                        Epubly.ui.updateHeaderInfo(Epubly.state.metadata.title, Epubly.state.metadata.author, chapterName);
                        Epubly.toc.highlight(idx);
                        
                        this.throttledStatsUpdate(idx);
                    }
                }
            });
        }, { root: document.getElementById('viewer'), threshold: 0.1 });

        document.querySelectorAll('.chapter-container').forEach(el => Epubly.state.observer.observe(el));
    },

    handleNavigation() {
        if (this.pdfState.mode === 'custom') return; // No auto-load in custom zoom mode

        const viewer = document.getElementById('viewer');
        
        if (Epubly.state.renderedChapters.size === 0 && Epubly.state.currentFormat === 'epub') return;

        if (Epubly.state.currentFormat === 'epub') {
           // Infinite Scroll Logic
           if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 600 && !Epubly.state.isLoadingNext) {
               const lastIdx = Math.max(...Epubly.state.renderedChapters);
               if (isFinite(lastIdx) && lastIdx < Epubly.state.spine.length - 1) {
                   Epubly.state.isLoadingNext = true;
                   document.getElementById('scroll-loader').style.display = 'block';
                   
                   this.renderChapter(lastIdx + 1, 'append').then(async () => {
                        document.getElementById('scroll-loader').style.display = 'none';
                        this.initObservers();
                        await this.ensureContentFillsScreen(lastIdx + 1);
                        Epubly.state.isLoadingNext = false;
                   });
               }
           }
        }
        this.saveCurrentPosition();
    },

    saveCurrentPosition(force = false) {
        if (this.pdfState.mode === 'custom') return; // Don't save transformed coordinates as scrollTop

        const viewer = document.getElementById('viewer');
        if (Epubly.state.currentFormat === 'epub') {
            const firstChapter = document.querySelector('.chapter-container');
            if(firstChapter) {
                 const idx = parseInt(firstChapter.dataset.index);
                 Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, viewer.scrollTop);
                 this.throttledStatsUpdate(idx, force);
            }
        } else {
             // PDF Scroll Position
             Epubly.storage.saveLocation(Epubly.state.currentBookId, 0, viewer.scrollTop);
        }
    },

    throttledStatsUpdate(idx, force = false, explicitProgress = null) {
        const now = Date.now();
        // Save to DB at most once every 3 seconds to update Progress %, OR if forced (touch end)
        if (force || (now - this.lastStatsSave > 3000)) {
            this.lastStatsSave = now;
            let progress = 0;
            if (explicitProgress !== null) {
                progress = explicitProgress;
            } else if (Epubly.state.spine.length > 0) {
                 progress = idx / Epubly.state.spine.length;
            }
            Epubly.storage.updateBookStats(Epubly.state.currentBookId, 0, progress);
        }
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
};
