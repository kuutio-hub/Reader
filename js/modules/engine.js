
import { Utils } from './utils.js';

/**
 * Parsing & Rendering Engine
 */
export const Engine = {
    resolvePath: Utils.resolvePath,

    async loadBook(arrayBuffer, bookId, format = 'epub') {
        Epubly.ui.showLoader();
        
        // RESET STATE via global object
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
            document.getElementById('viewer').scrollTop = savedPos;
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

    initObservers() {
        if (Epubly.settings.get().viewMode === 'paged') return;

        Epubly.state.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const idx = parseInt(entry.target.dataset.index);
                    const scrollTop = document.getElementById('viewer').scrollTop;
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
        
        if (settings.viewMode === 'scroll') {
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
                const firstChapter = document.querySelector('.chapter-container');
                if(firstChapter) {
                     const idx = parseInt(firstChapter.dataset.index);
                     Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, viewer.scrollTop);
                }
             } else {
                 Epubly.storage.saveLocation(Epubly.state.currentBookId, 0, viewer.scrollTop);
             }
        } else {
            this.updatePageCounts();
            if (Epubly.state.currentFormat === 'epub') {
                const currentChapterIdx = Math.max(...Epubly.state.renderedChapters);
                Epubly.storage.saveLocation(Epubly.state.currentBookId, currentChapterIdx, viewer.scrollLeft);
            } else {
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
};
