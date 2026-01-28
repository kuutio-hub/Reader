
import { Utils } from './utils.js';

/**
 * Parsing & Rendering Engine
 */
export const Engine = {
    resolvePath: Utils.resolvePath,
    lastStatsSave: 0, // Timestamp for throttling DB writes

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
            
            // Attach Scroll Saver (Immediate & Touch)
            const viewer = document.getElementById('viewer');
            viewer.onscroll = this.handleNavigation.bind(this);
            // Ensure position saves on touch end (mobile optimization)
            viewer.ontouchend = () => {
                this.saveCurrentPosition(true); // true = force update
            };

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
        
        for (let pageNum = 1; pageNum <= Epubly.state.pdfDoc.numPages; pageNum++) {
            const page = await Epubly.state.pdfDoc.getPage(pageNum);
            
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page';
            canvas.dataset.pageNumber = pageNum;
            
            const scale = 2.0; 
            const viewport = page.getViewport({ scale: scale });

            canvas.height = viewport.height;
            canvas.width = viewport.width;
            canvas.style.width = '100%';
            canvas.style.height = 'auto';

            canvas.onclick = (e) => { e.target.classList.toggle('zoomed'); };

            const renderContext = {
                canvasContext: canvas.getContext('2d'),
                viewport: viewport
            };
            
            await page.render(renderContext).promise;
            viewerContent.appendChild(canvas);
        }

        const savedLoc = Epubly.storage.getLocation(bookId);
        if(savedLoc) {
            const parts = savedLoc.split(',');
            const savedPos = parseInt(parts[1]) || 0;
            requestAnimationFrame(() => {
                document.getElementById('viewer').scrollTop = savedPos;
            });
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

        // Stabilize scroll
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const viewer = document.getElementById('viewer');
                viewer.scrollTop = savedPos;
            });
        });
        
        this.initObservers();
        this.parseTOC(opfDoc);
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
        
        if (method === 'prepend') {
            viewer.insertBefore(chapterContainer, viewer.firstChild);
        } else {
            viewer.appendChild(chapterContainer);
        }

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
        const viewer = document.getElementById('viewer');
        if (Epubly.state.renderedChapters.size === 0) return;

        if (Epubly.state.currentFormat === 'epub') {
           // 1. SCROLL DOWN (Load Next)
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

           // 2. SCROLL UP (Load Previous)
           // If we are close to the top and haven't loaded the first chapter yet
           if (viewer.scrollTop < 100 && !Epubly.state.isLoadingPrev) {
               const firstIdx = Math.min(...Epubly.state.renderedChapters);
               if (isFinite(firstIdx) && firstIdx > 0) {
                   Epubly.state.isLoadingPrev = true;
                   const loader = document.getElementById('top-loader');
                   if(loader) loader.style.display = 'block';
                   
                   const oldScrollHeight = viewer.scrollHeight;
                   
                   this.renderChapter(firstIdx - 1, 'prepend').then(() => {
                        // Adjust scroll position to maintain visual continuity
                        const newScrollHeight = viewer.scrollHeight;
                        const addedHeight = newScrollHeight - oldScrollHeight;
                        viewer.scrollTop += addedHeight;
                        
                        if(loader) loader.style.display = 'none';
                        this.initObservers();
                        Epubly.state.isLoadingPrev = false;
                   });
               }
           }
        }
        
        this.saveCurrentPosition();
    },

    saveCurrentPosition(force = false) {
        const viewer = document.getElementById('viewer');
        if (Epubly.state.currentFormat === 'epub') {
            const firstChapter = document.querySelector('.chapter-container');
            if(firstChapter) {
                 const idx = parseInt(firstChapter.dataset.index);
                 Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, viewer.scrollTop);
                 this.throttledStatsUpdate(idx, force);
            }
        } else {
             // PDF
             Epubly.storage.saveLocation(Epubly.state.currentBookId, 0, viewer.scrollTop);
        }
    },

    throttledStatsUpdate(idx, force = false) {
        const now = Date.now();
        // Save to DB at most once every 2 seconds to update Progress %, OR if forced (touch end)
        if (force || (now - this.lastStatsSave > 2000)) {
            this.lastStatsSave = now;
            const progress = Epubly.state.spine.length > 0 ? (idx / Epubly.state.spine.length) : 0;
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
