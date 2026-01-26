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
        history: [] // Navigation stack: [{chapterIndex, scrollPosition}, ...]
    },

    // --- NAVIGATION MANAGER ---
    navigation: {
        pushState() {
            const viewer = document.getElementById('viewer');
            let firstVisibleChapter = document.querySelector('.chapter-container');
            if (!firstVisibleChapter) return;

            // Find the first visible chapter
            for(const chapter of document.querySelectorAll('.chapter-container')) {
                const rect = chapter.getBoundingClientRect();
                if (rect.bottom > 0) {
                    firstVisibleChapter = chapter;
                    break;
                }
            }
            
            const currentIdx = parseInt(firstVisibleChapter.dataset.index);
            
            Epubly.state.history.push({
                chapterIndex: currentIdx,
                scrollTop: viewer.scrollTop
            });
            Epubly.ui.showFloatingBackButton(false);
        },
        
        popState() {
            if(Epubly.state.history.length === 0) return;
            const state = Epubly.state.history.pop();
            Epubly.ui.showFloatingBackButton(false);
            
            document.getElementById('viewer-content').innerHTML = '';
            Epubly.state.renderedChapters.clear();
            Epubly.engine.renderChapter(state.chapterIndex, 'clear').then(() => {
                document.getElementById('viewer').scrollTop = state.scrollTop;
            });
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
            Epubly.ui.showFloatingBackButton(true);
        },

        scrollToHash(hash) {
            if (!hash) return;
            // The timeout is a workaround to ensure the DOM has been painted after renderChapter
            setTimeout(() => {
                const target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    console.warn(`Hash target #${hash} not found.`);
                }
            }, 100);
        }
    },

    // --- ENGINE ---
    engine: {
        async loadBook(arrayBuffer, bookId) {
            Epubly.ui.showLoader();
            
            Object.assign(Epubly.state, {
                zip: null, spine: [], manifest: {}, renderedChapters: new Set(),
                toc: [], rootPath: '', currentBookId: bookId, activeBookSessionStart: Date.now(),
                isLoadingNext: false, isLoadingPrev: false, history: []
            });
            Epubly.ui.showFloatingBackButton(false);

            if(Epubly.state.observer) Epubly.state.observer.disconnect();

            Epubly.highlights.load(bookId);
            Epubly.highlights.renderList(); 

            try {
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
                const savedLoc = Epubly.storage.getLocation(bookId);
                if(savedLoc) {
                    const idx = parseInt(savedLoc.split(',')[0]);
                    if(!isNaN(idx) && idx < Epubly.state.spine.length) startIdx = idx;
                }

                document.getElementById('viewer-content').innerHTML = '';
                Epubly.ui.showReaderView();
                
                await this.renderChapter(startIdx, 'clear');

                if (savedLoc) {
                    const scrollTop = parseInt(savedLoc.split(',')[1]);
                    if (!isNaN(scrollTop)) document.getElementById('viewer').scrollTop = scrollTop;
                }
                
                this.initObservers();
                document.getElementById('viewer').onscroll = this.handleScroll.bind(this);

                this.parseTOC(opfDoc);
                
                Epubly.ui.hideLoader();
            } catch (e) {
                console.error("Engine Error:", e);
                alert("Hiba: " + e.message);
                Epubly.ui.hideLoader();
                Epubly.ui.showLibraryView();
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
                    img.src = URL.createObjectURL(blob);
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
            Epubly.highlights.apply(index, chapterContainer);
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
            Epubly.state.observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const idx = parseInt(entry.target.dataset.index);
                        const scrollTop = document.getElementById('viewer').scrollTop;
                        Epubly.storage.saveLocation(Epubly.state.currentBookId, idx, scrollTop);
                        
                        const hTag = entry.target.querySelector('h1, h2, h3');
                        const chapterName = (hTag && hTag.innerText.length < 50) ? hTag.innerText : `Fejezet ${idx + 1}`;
                        
                        Epubly.ui.updateHeaderInfo(Epubly.state.metadata.title, Epubly.state.metadata.author, chapterName);
                        Epubly.toc.highlight(idx);
                    }
                });
            }, { root: document.getElementById('viewer'), threshold: 0.1 });

            document.querySelectorAll('.chapter-container').forEach(el => Epubly.state.observer.observe(el));
            
            const mutationObserver = new MutationObserver(mutations => {
                mutations.forEach(m => m.addedNodes.forEach(n => {
                    if (n.nodeType === 1 && n.classList.contains('chapter-container')) {
                        Epubly.state.observer.observe(n);
                    }
                }));
            });
            mutationObserver.observe(document.getElementById('viewer-content'), { childList: true });
        },

        async handleScroll() {
            const viewer = document.getElementById('viewer');
            if (!viewer) return;
            if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 600 && !Epubly.state.isLoadingNext) {
                const lastIdx = Math.max(...Epubly.state.renderedChapters);
                if (lastIdx < Epubly.state.spine.length - 1) {
                    Epubly.state.isLoadingNext = true;
                    document.getElementById('scroll-loader').style.display = 'block';
                    await this.renderChapter(lastIdx + 1, 'append');
                    document.getElementById('scroll-loader').style.display = 'none';
                    Epubly.state.isLoadingNext = false;
                }
            }
            if (viewer.scrollTop < 50 && !Epubly.state.isLoadingPrev) {
                const firstIdx = Math.min(...Epubly.state.renderedChapters);
                if (firstIdx > 0) {
                    Epubly.state.isLoadingPrev = true;
                    document.getElementById('top-loader').style.display = 'block';
                    const oldHeight = viewer.scrollHeight;
                    await this.renderChapter(firstIdx - 1, 'prepend');
                    viewer.scrollTop += viewer.scrollHeight - oldHeight;
                    document.getElementById('top-loader').style.display = 'none';
                    Epubly.state.isLoadingPrev = false;
                }
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
    },

    // --- SEARCH ---
    search: {
        async run(query) {
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

    // --- HIGHLIGHTS ---
    highlights: {
        load(bookId) {
            const saved = localStorage.getItem(`epubly-highlights-${bookId}`);
            Epubly.state.highlights[bookId] = saved ? JSON.parse(saved) : [];
        },
        save() {
            const bookId = Epubly.state.currentBookId;
            if(bookId) {
                localStorage.setItem(`epubly-highlights-${bookId}`, JSON.stringify(Epubly.state.highlights[bookId]));
            }
        },
        add(color = 'yellow') {
            const selection = window.getSelection();
            if(!selection.rangeCount || selection.isCollapsed) return;
            
            const chapterDiv = selection.anchorNode.parentElement.closest('.chapter-container');
            if(!chapterDiv) return;

            const idx = parseInt(chapterDiv.dataset.index);
            const bookId = Epubly.state.currentBookId;
            const range = selection.getRangeAt(0);
            
            const highlightData = {
                id: Date.now(),
                type: 'text',
                chapterIndex: idx,
                text: range.toString(),
                color: color,
                comment: ''
            };

            if(!Epubly.state.highlights[bookId]) Epubly.state.highlights[bookId] = [];
            Epubly.state.highlights[bookId].push(highlightData);
            this.save();
            this.renderList();
            
            this.applyToRange(range, highlightData);
            
            const menu = document.getElementById('highlight-menu');
            if (menu) {
                menu.style.opacity = '0';
                menu.style.pointerEvents = 'none';
            }
            selection.removeAllRanges();
        },
        updateComment(id, commentText) {
            const bookId = Epubly.state.currentBookId;
            const highlight = Epubly.state.highlights[bookId].find(h => h.id === id);
            if (highlight) {
                highlight.comment = commentText;
                this.save();
                this.renderList(document.querySelector('.hl-filter-btn.active')?.dataset.color || 'all');
            }
        },
        changeColor(id, newColor) {
            const bookId = Epubly.state.currentBookId;
            const highlight = Epubly.state.highlights[bookId].find(h => h.id === id);
            if (highlight) {
                highlight.color = newColor;
                this.save();
                this.renderList(document.querySelector('.hl-filter-btn.active')?.dataset.color || 'all');
                document.querySelectorAll('.chapter-container').forEach(container => {
                    container.innerHTML = container.innerHTML.replace(/<span class="highlighted-text[^>]*>([^<]*)<\/span>/g, '$1'); 
                    this.apply(parseInt(container.dataset.index), container);
                });
            }
        },
        applyToRange(range, highlight) {
            const span = document.createElement('span');
            span.className = `highlighted-text hl-${highlight.color}`;
            span.dataset.highlightId = highlight.id;
            try { range.surroundContents(span); } catch (e) { console.warn("Complex selection not supported yet.", e); }
        },
        apply(chapterIndex, container) {
            const bookId = Epubly.state.currentBookId;
            const items = (Epubly.state.highlights[bookId] || []).filter(h => h.type === 'text' && h.chapterIndex === chapterIndex);
            if (items.length === 0) return;

            items.forEach(h => {
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while(node = walker.nextNode()) {
                    if (node.parentElement.classList.contains('highlighted-text')) continue;
                    const index = node.nodeValue.indexOf(h.text);
                    if (index !== -1) {
                        const range = document.createRange();
                        range.setStart(node, index);
                        range.setEnd(node, index + h.text.length);
                        this.applyToRange(range, h);
                        // This simple approach may not find all occurrences if the text node is split.
                        // For this app's purpose, highlighting the first match is sufficient.
                        break;
                    }
                }
            });
        },
        renderList(filterColor = 'all') {
            const list = document.getElementById('highlights-list');
            if(!list) return;
            const bookId = Epubly.state.currentBookId;
            let items = Epubly.state.highlights[bookId] || [];

            if (filterColor !== 'all') {
                items = items.filter(h => h.color === filterColor);
            }
            
            list.innerHTML = '';
            if(items.length === 0) {
                list.innerHTML = '<p style="text-align:center; color:var(--text-muted); margin-top:20px;">Nincsenek a szűrőnek megfelelő jegyzetek.</p>';
                return;
            }

            items.sort((a, b) => a.chapterIndex - b.chapterIndex).forEach(h => {
                const item = document.createElement('div');
                item.className = 'highlight-item';
                item.style.borderLeftColor = `var(--hl-color-${h.color}, #ccc)`;
                
                const content = h.type === 'image' ? `[Kép könyvjelző]` : `"${h.text.substring(0, 80)}..."`;
                
                item.innerHTML = `
                    <p class="highlight-text">${content}</p>
                    ${h.comment ? `<div class="highlight-comment-display">${h.comment}</div>` : ''}
                    <div class="highlight-meta">
                        <span>Fejezet: ${h.chapterIndex + 1}</span>
                        <div class="hl-meta-tools">
                             <div class="hl-recolor-palette">
                                <span class="hl-color-dot hl-yellow" data-color="yellow"></span>
                                <span class="hl-color-dot hl-green" data-color="green"></span>
                                <span class="hl-color-dot hl-blue" data-color="blue"></span>
                                <span class="hl-color-dot hl-red" data-color="red"></span>
                            </div>
                            <button class="hl-comment-btn icon-btn" title="Megjegyzés">
                                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"></path></svg>
                            </button>
                        </div>
                    </div>
                    <div class="highlight-comment-container"></div>
                `;

                const commentContainer = item.querySelector('.highlight-comment-container');

                item.querySelector('.hl-comment-btn').onclick = (e) => {
                    e.stopPropagation();
                    if (commentContainer.innerHTML !== '') {
                        commentContainer.innerHTML = '';
                    } else {
                        commentContainer.innerHTML = `
                        <div class="highlight-comment-editor">
                            <textarea>${h.comment || ''}</textarea>
                            <button class="btn btn-primary">Mentés</button>
                        </div>`;
                        const textarea = commentContainer.querySelector('textarea');
                        textarea.focus();
                        commentContainer.querySelector('button').onclick = (ev) => {
                            ev.stopPropagation();
                            this.updateComment(h.id, textarea.value);
                        };
                    }
                };

                item.onclick = (e) => {
                    if (e.target.closest('.hl-meta-tools, .highlight-comment-container')) return;
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(h.chapterIndex, 'clear');
                };

                item.querySelectorAll('.hl-color-dot').forEach(dot => {
                    dot.onclick = (e) => {
                        e.stopPropagation();
                        this.changeColor(h.id, dot.dataset.color);
                    }
                });
                list.appendChild(item);
            });
        }
    },

    // --- READER SETTINGS ---
    reader: {
        updateSessionStats() {
            if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
            const now = Date.now();
            const duration = now - Epubly.state.activeBookSessionStart;
            Epubly.state.activeBookSessionStart = now;
            
            const maxRendered = Epubly.state.renderedChapters.size > 0 ? Math.max(...Epubly.state.renderedChapters) : 0;
            const progress = (maxRendered + 1) / Epubly.state.spine.length;
            Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, progress);
        },
        applySettings(settings) {
            const viewer = document.getElementById('viewer-content');
            if(!viewer) return;
            
            Object.assign(viewer.style, {
                fontFamily: settings.fontFamily,
                fontSize: `${settings.fontSize}%`,
                lineHeight: settings.lineHeight,
                textAlign: settings.textAlign,
                fontWeight: settings.fontWeight,
                color: settings.fontColor,
                letterSpacing: `${settings.letterSpacing}px`,
                paddingLeft: `${settings.margin}%`,
                paddingRight: `${settings.margin}%`
            });
            
            document.body.className = `theme-${settings.theme}`;
            if (settings.theme === 'terminal') {
                document.documentElement.style.setProperty('--terminal-color', settings.terminalColor);
            }
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
            bind('margin-range', 'input', 'margin');
            bind('font-weight-range', 'input', 'fontWeight');
            bind('letter-spacing-range', 'input', 'letterSpacing');
            bind('font-color-picker', 'input', 'fontColor');
            bind('terminal-color-picker', 'input', 'terminalColor');
            bind('font-family-select', 'change', 'fontFamily');
            
            ['align-toggle-group', 'theme-toggle-group'].forEach(id => {
                document.getElementById(id)?.querySelectorAll('.toggle-btn').forEach(btn => {
                    btn.addEventListener('click', () => this.handleUpdate(id.includes('align') ? 'textAlign' : 'theme', btn.dataset.val));
                });
            });
        },
        get() {
            const defaults = {
                fontSize: '100', lineHeight: '1.6', margin: '10',
                textAlign: 'left', fontFamily: "'Inter', sans-serif",
                fontWeight: '400', letterSpacing: '0', fontColor: 'var(--text)',
                theme: 'dark', terminalColor: '#00FF41'
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
            setVal('margin-range', s.margin);
            setVal('font-weight-range', s.fontWeight);
            setVal('letter-spacing-range', s.letterSpacing);
            setVal('font-color-picker', s.fontColor);
            setVal('terminal-color-picker', s.terminalColor);
            setVal('font-family-select', s.fontFamily);
            
            const updateToggle = (groupId, val) => {
                document.getElementById(groupId)?.querySelectorAll('.toggle-btn').forEach(b => { 
                    b.classList.toggle('active', b.dataset.val === val); 
                });
            };
            updateToggle('align-toggle-group', s.textAlign);
            updateToggle('theme-toggle-group', s.theme);
            
            const terminalPicker = document.getElementById('terminal-color-picker-container');
            if (terminalPicker) {
                terminalPicker.style.display = s.theme === 'terminal' ? 'block' : 'none';
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
                request.onerror = () => reject("IndexedDB error: " + request.error);
                request.onsuccess = e => { this.db = e.target.result; resolve(this.db); };
                request.onupgradeneeded = e => {
                    if (!e.target.result.objectStoreNames.contains('books')) {
                        e.target.result.createObjectStore('books', { keyPath: 'id' });
                    }
                };
                request.onblocked = () => {
                    reject("Az adatbázis frissítése blokkolva. Kérjük, zárja be az Epubly összes többi lapját, majd töltse be újra az oldalt.");
                };
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
                const arrayBuffer = await file.arrayBuffer();
                const zip = await JSZip.loadAsync(arrayBuffer);
                const opfPath = (await new DOMParser().parseFromString(await zip.file("META-INF/container.xml").async("string"), "application/xml")).querySelector("rootfile").getAttribute("full-path");
                const opfDoc = new DOMParser().parseFromString(await zip.file(opfPath).async("string"), "application/xml");
                const metadata = {};
                ['title', 'creator', 'description'].forEach(tag => {
                    metadata[tag] = opfDoc.getElementsByTagName(`dc:${tag}`)[0]?.textContent || "";
                });
                let coverUrl = null;
                const coverItem = opfDoc.querySelector("item[properties~='cover-image'], item[id='cover']");
                if (coverItem) {
                    const href = Epubly.engine.resolvePath(opfPath, coverItem.getAttribute("href"));
                    const coverFile = zip.file(href);
                    if(coverFile) coverUrl = URL.createObjectURL(await coverFile.async("blob"));
                }
                await this.saveBook({
                    id: `${Date.now()}`, data: arrayBuffer, metadata: {...metadata, coverUrl},
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
        getLocation(bookId) { return localStorage.getItem(`epubly-loc-${id}`); },
        saveLocation(bookId, idx, scroll) { localStorage.setItem(`epubly-loc-${bookId}`, `${idx},${Math.round(scroll)}`); }
    },

    library: {
        async render() {
            const grid = document.getElementById('library-grid');
            if(!grid) return;
            grid.innerHTML = '';
            const books = await Epubly.storage.getAllBooks();
            if (!books || books.length === 0) {
                grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1; text-align: center; margin-top: 40px;">A könyvtárad üres.<br>Kattints az "Importálás" gombra!</p>`;
                return;
            }
            books.sort((a,b) => (b.stats?.lastRead || 0) - (a.stats?.lastRead || 0)).forEach(book => {
                const card = document.createElement('div');
                card.className = 'book-card';
                card.innerHTML = `
                    <div class="book-cover"><img src="${book.metadata.coverUrl || ''}" alt="${book.metadata.title}"></div>
                    <div class="book-title" title="${book.metadata.title}">${book.metadata.title || "Ismeretlen"}</div>
                    <div class="book-author" title="${book.metadata.creator}">${book.metadata.creator || "Ismeretlen"}</div>
                `;
                card.onclick = () => Epubly.ui.showBookInfoModal(book);
                grid.appendChild(card);
            });
        }
    },
    
    dataSync: {
        _arrayBufferToBase64(buffer) {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return window.btoa(binary);
        },
        _base64ToArrayBuffer(base64) {
            const binary_string = window.atob(base64);
            const len = binary_string.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary_string.charCodeAt(i);
            }
            return bytes.buffer;
        },
        async exportData() {
            Epubly.ui.showLoader();
            try {
                const books = await Epubly.storage.getAllBooks();
                const booksForExport = books.map(book => ({
                    ...book,
                    data: this._arrayBufferToBase64(book.data)
                }));
                
                const highlights = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key.startsWith('epubly-highlights-')) {
                        highlights[key] = localStorage.getItem(key);
                    }
                }

                const backup = {
                    version: version,
                    exportDate: new Date().toISOString(),
                    books: booksForExport,
                    settings: localStorage.getItem('epubly-settings'),
                    highlights: highlights
                };
                
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `epubly-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                console.error("Export failed:", e);
                alert("Hiba az adatok exportálása közben.");
            } finally {
                Epubly.ui.hideLoader();
            }
        },
        async importData(file) {
             if (!confirm("Biztosan importálod az adatokat? Ez felülírja az összes jelenlegi könyvet, beállítást és jegyzetet!")) {
                return;
            }
            Epubly.ui.showLoader();
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const backup = JSON.parse(e.target.result);
                    
                    // Clear existing data
                    await Epubly.storage.clearBooks();
                    localStorage.clear();
                    
                    // Import settings
                    if (backup.settings) {
                        localStorage.setItem('epubly-settings', backup.settings);
                    }
                    
                    // Import highlights
                    if (backup.highlights) {
                        for (const key in backup.highlights) {
                            localStorage.setItem(key, backup.highlights[key]);
                        }
                    }

                    // Import books
                    if (backup.books && backup.books.length > 0) {
                        for (const book of backup.books) {
                            await Epubly.storage.saveBook({
                                ...book,
                                data: this._base64ToArrayBuffer(book.data)
                            });
                        }
                    }
                    alert("Importálás sikeres! Az alkalmazás újraindul.");
                    location.reload();
                } catch (error) {
                    console.error("Import failed:", error);
                    alert("Hiba az importálás során. A fájl lehet, hogy sérült.");
                    Epubly.ui.hideLoader();
                }
            };
            reader.readAsText(file);
        }
    },

    ui: {
        init() {
            // Event listeners
            document.body.addEventListener('click', e => {
                const target = e.target;
                const closest = (selector) => target.closest(selector);
                
                if (closest('.close-sidebar')) Epubly.ui.toggleSidebar(closest('.close-sidebar').dataset.target);
                if (closest('.sidebar-tab')) this.handleTabClick(target);
                if (closest('#app-logo-btn')) { Epubly.reader.updateSessionStats(); Epubly.ui.showLibraryView(); }
                if (closest('.modal-close')) closest('.modal').classList.remove('visible');
                if (target.classList.contains('modal')) target.classList.remove('visible');
                if (closest('.hl-color-btn')) Epubly.highlights.add(target.dataset.color);
                if (closest('#btn-do-search')) Epubly.search.run(document.getElementById('search-input').value);
                if (closest('#btn-theme-toggle')) this.toggleTheme();
                if (closest('#btn-delete-all') && confirm("FIGYELEM! Ez a gomb töröl minden könyvet, jegyzetet és beállítást. A művelet nem vonható vissza. Folytatod?")) {
                    localStorage.clear();
                    Epubly.storage.clearBooks().then(() => location.reload());
                }
                if (closest('#floating-back-btn')) Epubly.navigation.popState();
                if (closest('.hl-filter-btn')) {
                    document.querySelectorAll('.hl-filter-btn').forEach(b => b.classList.remove('active'));
                    target.classList.add('active');
                    Epubly.highlights.renderList(target.dataset.color);
                }
                if (closest('#btn-export-data')) Epubly.dataSync.exportData();
            });

            const importInput = document.getElementById('import-file');
            if (importInput) {
                importInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        Epubly.dataSync.importData(e.target.files[0]);
                        e.target.value = ''; // Reset for next import
                    }
                });
            }

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
            
            // Selection Menu
            document.addEventListener('selectionchange', () => {
                const sel = window.getSelection();
                const menu = document.getElementById('highlight-menu');
                if(!menu) return;
                if(sel.isCollapsed || sel.toString().trim().length < 2) {
                    menu.style.opacity = '0'; menu.style.pointerEvents = 'none';
                } else {
                    const rect = sel.getRangeAt(0).getBoundingClientRect();
                    menu.style.opacity = '1';
                    menu.style.pointerEvents = 'auto';
                    menu.style.top = `${rect.bottom + window.scrollY + 10}px`;
                    menu.style.left = `${Math.max(10, rect.left + window.scrollX)}px`; 
                }
            });

            // Print QR Code
            window.onbeforeprint = () => this.generateQRCode('d0a663f6-b055-40e8-b3d5-399236cb6b94');
            window.onafterprint = () => this.generateQRCode('https://epubly.hu');
            
            const footer = document.getElementById('footer-year');
            if(footer) footer.textContent = `Epubly.hu v${version} © ${new Date().getFullYear()}`;
            this.generateQRCode('https://epubly.hu');
        },

        handleTabClick(tab) {
            const container = tab.closest('.modal-content, .sidebar');
            if(!container) return;
            container.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
            container.querySelectorAll('.sidebar-pane, .wiki-content').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const targetPane = container.querySelector(`#${tab.dataset.tab}`);
            if(targetPane) targetPane.classList.add('active');
        },
        
        toggleTheme() {
            const s = Epubly.settings.get();
            const themes = ['light', 'dark', 'sepia', 'terminal'];
            const nextTheme = themes[(themes.indexOf(s.theme) + 1) % themes.length];
            Epubly.settings.handleUpdate('theme', nextTheme);
            this.updateThemeIcons(nextTheme);
        },

        updateThemeIcons(theme) {
            const sun = document.getElementById('theme-icon-sun');
            const moon = document.getElementById('theme-icon-moon');
            if(sun && moon) {
                sun.style.display = (theme === 'light' || theme === 'sepia') ? 'none' : 'block';
                moon.style.display = (theme === 'light' || theme === 'sepia') ? 'block' : 'none';
            }
        },

        toggleSidebar(id) {
            const sidebar = document.getElementById(id);
            if(sidebar) sidebar.classList.toggle('visible');
        },

        showModal(id) { document.getElementById(id)?.classList.add('visible'); },
        hideModal(id) { document.getElementById(id)?.classList.remove('visible'); },
        
        showLoader() { document.getElementById('loader')?.classList.remove('hidden'); },
        hideLoader() { document.getElementById('loader')?.classList.add('hidden'); },
        
        updateHeaderInfo(title, author, chapter) {
            const set = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
            set('header-author', author || "");
            set('header-title', title || "");
            set('header-chapter', chapter ? `(${chapter})` : "");
            const sep = document.querySelector('.info-sep');
            if(sep) sep.style.display = author ? 'inline' : 'none';
        },
        
        showFloatingBackButton(visible) {
            document.getElementById('floating-back-btn-container')?.classList.toggle('visible', visible);
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
            const actions = document.getElementById('top-actions-container');
            if(actions) actions.innerHTML = `<button class="btn btn-primary" onclick="Epubly.ui.showModal('import-modal')">Importálás</button>`;
            this.library.render();
        },
        showBookInfoModal(book) {
            const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
            const img = document.getElementById('detail-cover-img');
            if(img) img.src = book.metadata.coverUrl || '';
            set('detail-title', book.metadata.title);
            set('detail-author', book.metadata.creator);
            const desc = document.getElementById('detail-desc');
            if(desc) desc.innerHTML = book.metadata.description || "Leírás nem elérhető.";
            
            const stats = book.stats || { totalTime: 0, progress: 0 };
            const minutes = Math.floor(stats.totalTime / 60000);
            set('detail-stats-time', `${Math.floor(minutes/60)}ó ${minutes%60}p`);
            set('detail-stats-prog', `${Math.round((stats.progress || 0) * 100)}%`);
            set('btn-read-book', stats.progress > 0.01 ? 'FOLYTATÁS' : 'OLVASÁS');
            
            document.getElementById('btn-read-book').onclick = () => { this.hideModal('book-details-modal'); Epubly.engine.loadBook(book.data, book.id); };
            document.getElementById('btn-show-toc').onclick = async () => { this.hideModal('book-details-modal'); await Epubly.engine.loadBook(book.data, book.id); this.toggleSidebar('sidebar-toc'); };
            document.getElementById('btn-delete-book').onclick = async () => { if(confirm('Biztosan törlöd?')) { await Epubly.storage.deleteBook(book.id); this.hideModal('book-details-modal'); this.library.render(); }};
            this.showModal('book-details-modal');
        },
        generateQRCode(data) {
            const qrContainer = document.getElementById('mohu-qr-container');
            if(!qrContainer) return;
            const M = [[1,0,1,0,0,1,1,1,1,1,0,1,0,0,0,1,0,0,1,0,1],[1,0,1,0,1,1,0,1,1,0,0,0,1,1,0,0,0,1,1,0,1],[1,0,1,0,1,0,1,1,0,1,1,1,0,1,1,0,0,1,0,1,1],[1,0,1,0,0,1,0,1,0,1,0,0,0,1,0,1,0,1,1,1,1],[1,0,1,0,0,1,1,1,0,0,0,1,1,0,1,0,1,0,0,1,1],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,1,1,0,0,1,0,1,0,1,0,0,0,0,1,0,0,1,1,1,1],[0,1,0,1,1,1,1,0,1,0,1,0,0,1,0,1,1,0,0,0,0],[1,0,1,1,0,0,0,1,0,0,0,1,0,1,0,0,0,1,0,0,1],[1,1,0,0,0,1,0,0,1,1,1,1,1,1,1,1,0,1,1,0,0],[0,0,0,1,0,1,0,0,1,1,1,0,1,1,0,0,0,1,0,1,0],[1,0,0,1,1,0,1,1,1,0,1,0,1,0,0,1,1,0,1,0,0],[0,1,1,0,1,0,1,0,1,0,1,0,1,1,0,0,1,0,0,1,1],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,0,1,0,0,1,1,0,1,1,0,0,1,1,1,1,1,0,1,0,1],[0,1,0,1,0,0,0,1,0,0,0,1,1,0,1,0,0,1,1,1,0],[1,0,0,1,0,1,0,0,1,0,1,0,0,0,1,1,0,1,1,0,1],[1,0,1,0,0,1,1,1,1,1,0,1,0,0,0,1,0,0,1,0,1],[1,0,1,0,1,1,0,1,1,0,0,0,1,1,0,0,0,1,1,0,1],[1,0,1,0,1,0,1,1,0,1,1,1,0,1,1,0,0,1,0,1,1],[1,0,1,0,0,1,0,1,0,1,0,0,0,1,0,1,0,1,1,1,1]];
            const L = data.length;
            const size = 21;
            for(let y=0; y<9; y++) for(let x=0; x<9; x++) if((x<7&&y<7)||(x<7&&y>size-8)||(x>size-8&&y<7)) M[y][x]=1;
            const str = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
            let p=0;
            for (let i=0;i<L;i+=2) {let a=str.indexOf(data[i]);let b=(i+1<L)?str.indexOf(data[i+1]):0;let v=a*45+b;for(let j=0;j<11;j++,v=Math.floor(v/2)){M[9+Math.floor(p/2)][9+p%2]=v%2;p++;}}
            let path = '';
            for (let y=0;y<size;y++) for(let x=0;x<size;x++) if(M[y][x]) path+=`M${x},${y}h1v1h-1z`;
            qrContainer.innerHTML = `<svg viewBox="-2 -2 25 25"><path fill="black" d="${path}"/></svg>`;
        }
    },
    
    async init() {
        try {
            document.addEventListener('DOMContentLoaded', async () => {
                this.ui.init();
                this.settings.init();
                this.lightbox.init();
                await this.storage.getDb();
                this.ui.showLibraryView();
                this.ui.hideLoader();
                console.log(`Epubly v${version} Initialized.`);
            });
        } catch (error) {
            console.error("Fatal init error:", error);
            const loaderError = document.getElementById('loader-error');
            if(loaderError) {
                 document.getElementById('loader').classList.remove('hidden');
                 loaderError.textContent = error.message;
                 loaderError.style.display = 'block';
            }
        }
    }
};

window.Epubly = Epubly;
Epubly.init();