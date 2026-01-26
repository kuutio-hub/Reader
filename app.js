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
        globalTheme: 'dark',
        history: [] // Navigation stack: [{chapterIndex, scrollPosition}, ...]
    },

    // --- NAVIGATION MANAGER ---
    navigation: {
        pushState() {
            const viewer = document.getElementById('viewer');
            let currentIdx = 0;
            if(Epubly.state.renderedChapters.size > 0) {
                const chapters = document.querySelectorAll('.chapter-container');
                for(let c of chapters) {
                    const rect = c.getBoundingClientRect();
                    if(rect.top >= 0 && rect.top < window.innerHeight) {
                        currentIdx = parseInt(c.dataset.index);
                        break;
                    }
                }
            }
            
            Epubly.state.history.push({
                chapterIndex: currentIdx,
                scrollTop: viewer.scrollTop
            });
            Epubly.ui.updateBackButton();
        },
        
        popState() {
            if(Epubly.state.history.length === 0) return;
            const state = Epubly.state.history.pop();
            Epubly.ui.updateBackButton();
            
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
            
            if (!path || path === '') {
                this.scrollToHash(hash);
            } else {
                let targetIndex = -1;
                targetIndex = Epubly.state.spine.findIndex(s => s.href === path || s.href.endsWith(path));
                
                if (targetIndex !== -1) {
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(targetIndex, 'clear').then(() => {
                        if (hash) this.scrollToHash(hash);
                    });
                } else {
                    console.warn("Could not find target for:", href);
                }
            }
        },

        scrollToHash(hash) {
            if (!hash) return;
            const target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    },

    // --- ENGINE ---
    engine: {
        async loadBook(arrayBuffer, bookId) {
            Epubly.ui.showLoader();
            
            Epubly.state.zip = null;
            Epubly.state.spine = [];
            Epubly.state.manifest = {};
            Epubly.state.renderedChapters.clear();
            Epubly.state.currentBookId = bookId;
            Epubly.state.activeBookSessionStart = Date.now();
            Epubly.state.isLoadingNext = false;
            Epubly.state.history = []; 
            Epubly.ui.updateBackButton();

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

                const manifestItems = opfDoc.getElementsByTagName("item");
                for (let item of manifestItems) {
                    Epubly.state.manifest[item.getAttribute("id")] = {
                        href: item.getAttribute("href"),
                        type: item.getAttribute("media-type"),
                        fullPath: Epubly.state.rootPath + item.getAttribute("href")
                    };
                }

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

                const title = opfDoc.getElementsByTagName("dc:title")[0]?.textContent || "Névtelen Könyv";
                const author = opfDoc.getElementsByTagName("dc:creator")[0]?.textContent || "Ismeretlen Szerző";
                Epubly.state.metadata = { title, author };
                
                Epubly.ui.updateHeaderInfo(title, author, "");

                let startIdx = 0;
                const savedCfi = Epubly.storage.getLocation(bookId);
                if(savedCfi) {
                    const idx = parseInt(savedCfi);
                    if(!isNaN(idx) && idx < Epubly.state.spine.length) startIdx = idx;
                }

                document.getElementById('viewer-content').innerHTML = '';
                Epubly.ui.showReaderView();
                
                await this.renderChapter(startIdx, 'append');
                
                this.initObservers();
                document.getElementById('viewer').onscroll = this.handleScroll.bind(this);

                this.parseTOC(opfDoc);
                
                Epubly.ui.hideLoader();
                
                return Promise.resolve();
            } catch (e) {
                console.error("Engine Error:", e);
                alert("Hiba: " + e.message);
                Epubly.ui.hideLoader();
                Epubly.ui.showLibraryView();
                return Promise.reject(e);
            }
        },

        async renderChapter(index, method = 'append') {
            if (index < 0 || index >= Epubly.state.spine.length) return;
            if (Epubly.state.renderedChapters.has(index)) return;

            const chapterItem = Epubly.state.spine[index];
            const file = Epubly.state.zip.file(chapterItem.fullPath);
            if (!file) return;

            let htmlContent = await file.async("string");
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, "text/html");

            doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove());
            doc.querySelectorAll('*').forEach(el => {
                el.removeAttribute('style');
                el.removeAttribute('class');
            });

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
                    img.style.cursor = "pointer";
                    img.onclick = (e) => {
                        e.stopPropagation(); 
                        if(confirm("Szeretnéd elmenteni ezt a képet a jegyzetek közé?")) {
                            Epubly.highlights.addImage(index, src); 
                        }
                    };
                    if(img.tagName.toLowerCase() === 'image') img.setAttribute("href", url);
                }
            };
            await Promise.all(Array.from(images).map(processImage));

            const chapterContainer = document.createElement('div');
            chapterContainer.className = 'chapter-container';
            chapterContainer.dataset.index = index;
            
            if (doc.body) {
                chapterContainer.innerHTML = doc.body.innerHTML;
            } else {
                chapterContainer.innerText = "Hiba a fejezet megjelenítésekor.";
            }

            chapterContainer.addEventListener('click', (e) => Epubly.navigation.handleLinkClick(e));

            const viewer = document.getElementById('viewer-content');
            
            if (method === 'prepend') {
                viewer.insertBefore(chapterContainer, viewer.firstChild);
            } else {
                if (method === 'clear') viewer.innerHTML = '';
                viewer.appendChild(chapterContainer);
            }

            Epubly.state.renderedChapters.add(index);
            Epubly.reader.applySettings(Epubly.settings.get());
            Epubly.highlights.apply(index, chapterContainer);
            
            return chapterContainer;
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
                        
                        let chapterName = "Fejezet " + (idx + 1);
                        const hTag = entry.target.querySelector('h1, h2, h3');
                        if(hTag && hTag.innerText.length < 50) chapterName = hTag.innerText;
                        
                        Epubly.ui.updateHeaderInfo(Epubly.state.metadata.title, Epubly.state.metadata.author, chapterName);
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
            const scrollTop = viewer.scrollTop;
            const scrollHeight = viewer.scrollHeight;
            const clientHeight = viewer.clientHeight;

            // --- Overall Progress Update ---
            if (scrollHeight > clientHeight) {
                const progress = scrollTop / (scrollHeight - clientHeight);
                const percent = Math.min(100, Math.round(progress * 100));
                
                const ind = document.getElementById('progress-indicator');
                if (ind) ind.textContent = `${percent}%`;
                document.getElementById('reading-progress-fill').style.width = percent + "%";
            }


            // --- Infinite Scroll ---
            if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 600) {
                if(Epubly.state.isLoadingNext) return;
                const renderedIndices = Array.from(Epubly.state.renderedChapters).sort((a,b) => a-b);
                const lastIdx = renderedIndices[renderedIndices.length - 1];
                if (lastIdx < Epubly.state.spine.length - 1) {
                    Epubly.state.isLoadingNext = true;
                    document.getElementById('scroll-loader').style.display = 'block';
                    await this.renderChapter(lastIdx + 1, 'append');
                    document.getElementById('scroll-loader').style.display = 'none';
                    Epubly.state.isLoadingNext = false;
                }
            }

            if (viewer.scrollTop < 50) {
                if(Epubly.state.isLoadingPrev) return;
                const renderedIndices = Array.from(Epubly.state.renderedChapters).sort((a,b) => a-b);
                const firstIdx = renderedIndices[0];
                
                if (firstIdx > 0) {
                    Epubly.state.isLoadingPrev = true;
                    document.getElementById('top-loader').style.display = 'block';
                    const oldScrollHeight = viewer.scrollHeight;
                    await this.renderChapter(firstIdx - 1, 'prepend');
                    const newScrollHeight = viewer.scrollHeight;
                    viewer.scrollTop = newScrollHeight - oldScrollHeight + viewer.scrollTop;
                    document.getElementById('top-loader').style.display = 'none';
                    Epubly.state.isLoadingPrev = false;
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

    // --- SEARCH ---
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
                            <div style="font-weight:bold; font-size:0.8rem; color:var(--brand);">Fejezet ${i + 1}</div>
                            <div style="font-size:0.9rem; color:var(--text-muted);">...${snippet.replace(new RegExp(query, 'gi'), match => `<span style="background:rgba(212,175,55,0.3); color:inherit;">${match}</span>`)}...</div>
                        `;
                        item.style.marginBottom = "10px"; item.style.padding = "10px"; item.style.cursor = "pointer"; item.style.borderBottom = "1px solid var(--border)";
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
            if(bookId) {
                localStorage.setItem(`epubly-highlights-${bookId}`, JSON.stringify(Epubly.state.highlights[bookId]));
                this.renderList();
            }
        },
        add(color = 'yellow') {
            const selection = window.getSelection();
            if(!selection.rangeCount) return;
            const text = selection.toString().trim();
            if(!text || text.length < 1) return;

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
                
                let bgMap = {
                    'yellow': 'rgba(255, 235, 59, 0.4)',
                    'green': 'rgba(76, 175, 80, 0.4)',
                    'blue': 'rgba(33, 150, 243, 0.4)',
                    'red': 'rgba(244, 67, 54, 0.4)'
                };
                span.style.backgroundColor = bgMap[color];

                try { range.surroundContents(span); } catch(e) { console.warn("Complex selection not supported yet"); return; }

                if(!Epubly.state.highlights[bookId]) Epubly.state.highlights[bookId] = [];
                Epubly.state.highlights[bookId].push({
                    type: 'text',
                    chapterIndex: idx,
                    text: text,
                    color: color,
                    date: Date.now()
                });
                this.save();
                document.getElementById('highlight-menu').style.opacity = '0';
                selection.removeAllRanges();
            }
        },
        addImage(chapterIndex, src) {
            const bookId = Epubly.state.currentBookId;
            if(!Epubly.state.highlights[bookId]) Epubly.state.highlights[bookId] = [];
            Epubly.state.highlights[bookId].push({
                type: 'image',
                chapterIndex: chapterIndex,
                src: src, 
                date: Date.now()
            });
            this.save();
            alert("Kép mentve a jegyzetekhez!");
        },
        apply(chapterIndex, container) {
            const bookId = Epubly.state.currentBookId;
            const items = Epubly.state.highlights[bookId];
            if (!items) return;
        
            const bgMap = {
                'yellow': 'rgba(255, 235, 59, 0.4)',
                'green': 'rgba(76, 175, 80, 0.4)',
                'blue': 'rgba(33, 150, 243, 0.4)',
                'red': 'rgba(244, 67, 54, 0.4)'
            };
        
            items.forEach(h => {
                if (h.type === 'text' && h.chapterIndex === chapterIndex) {
                    const search = h.text;
        
                    (function walkAndReplace(node) {
                        if (node.nodeType === 3) { // TEXT_NODE
                            const index = node.data.indexOf(search);
                            if (index > -1) {
                                const parent = node.parentNode;
                                if (parent && parent.classList.contains('highlighted-text')) return;
        
                                const newSpan = document.createElement('span');
                                newSpan.className = 'highlighted-text';
                                newSpan.style.backgroundColor = bgMap[h.color];
        
                                const range = document.createRange();
                                range.setStart(node, index);
                                range.setEnd(node, index + search.length);
        
                                try {
                                    range.surroundContents(newSpan);
                                    // After surrounding, the structure is changed.
                                    // To highlight multiple occurrences, we need to continue searching.
                                    // The new node is `newSpan.nextSibling`.
                                    if(newSpan.nextSibling) {
                                      walkAndReplace(newSpan.nextSibling);
                                    }
                                } catch (e) {
                                    // This can fail if the selection is not 'well-formed'.
                                    console.warn(e);
                                }
                            }
                        } else if (node.nodeType === 1) { // ELEMENT_NODE
                            if (node.classList.contains('highlighted-text')) return;
                            
                            const children = Array.from(node.childNodes);
                            for (let i = 0; i < children.length; i++) {
                                walkAndReplace(children[i]);
                            }
                        }
                    })(container);
                }
            });
        },
        renderList() {
            const list = document.getElementById('highlights-list');
            if(!list) return;
            const bookId = Epubly.state.currentBookId;
            const items = Epubly.state.highlights[bookId] || [];
            list.innerHTML = '';
            if(items.length === 0) {
                list.innerHTML = '<p style="text-align:center; color:var(--text-muted); margin-top:20px;">Még nincsenek jegyzetek.</p>';
                return;
            }
            items.forEach(h => {
                const li = document.createElement('div');
                li.className = 'highlight-item';
                let content = '';
                if (h.type === 'image') {
                    content = `<span class="highlight-text">[Kép könyvjelző]</span>`;
                } else {
                    content = `<span class="highlight-text">"${h.text.substring(0, 50)}..."</span>`;
                }
                li.innerHTML = `
                    ${content}
                    <span class="highlight-meta">Fejezet: ${h.chapterIndex + 1}</span>
                `;
                li.onclick = () => {
                    Epubly.navigation.pushState(); 
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(h.chapterIndex, 'clear');
                    Epubly.ui.toggleSidebar('sidebar-toc'); 
                };
                list.appendChild(li);
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
            
            viewer.style.fontFamily = settings.fontFamily;
            viewer.style.fontSize = settings.fontSize + "%";
            viewer.style.lineHeight = settings.lineHeight;
            viewer.style.textAlign = settings.textAlign;
            viewer.style.fontWeight = settings.fontWeight;
            viewer.style.color = settings.fontColor;
            viewer.style.letterSpacing = settings.letterSpacing + "px";
            
            const pad = settings.margin + "%";
            viewer.style.paddingLeft = pad;
            viewer.style.paddingRight = pad;
            
            document.body.className = ''; 
            document.body.classList.add(`theme-${settings.theme}`);
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
                a.dataset.idx = item.index;
                a.className = "toc-link";
                
                a.onclick = () => {
                    Epubly.navigation.pushState(); 
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(item.index, 'clear');
                };
                li.appendChild(a);
                fragment.appendChild(li);
            });
            tocList.appendChild(fragment);
        },
        highlight(idx) {
            document.querySelectorAll('.toc-link').forEach(el => {
                if(parseInt(el.dataset.idx) === idx) {
                    el.classList.add('active');
                } else {
                    el.classList.remove('active');
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
            bindInput('font-weight-range', 'fontWeight');
            bindInput('letter-spacing-range', 'letterSpacing');
            bindInput('font-color-picker', 'fontColor');
            
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
        },
        get() {
            const defaults = {
                fontSize: '100', lineHeight: '1.6', margin: '10',
                textAlign: 'left', fontFamily: "'Inter', sans-serif",
                fontWeight: '400', letterSpacing: '0', fontColor: 'var(--text)',
                theme: 'dark'
            };
            const saved = JSON.parse(localStorage.getItem('epubly-settings')) || {};
            if(localStorage.getItem('epubly-theme')) saved.theme = localStorage.getItem('epubly-theme');
            
            // Adjust font color for contrast
            if (saved.theme === 'light' || saved.theme === 'sepia') {
                defaults.fontColor = '#1C1C1E'; 
            } else {
                defaults.fontColor = '#F2F2F7';
            }

            return { ...defaults, ...saved };
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
            setVal('font-family-select', s.fontFamily);
            
            const updateToggle = (groupId, val) => {
                const g = document.getElementById(groupId);
                if(g) g.querySelectorAll('.toggle-btn').forEach(b => { 
                    b.classList.toggle('active', b.dataset.val === val); 
                });
            };
            updateToggle('align-toggle-group', s.textAlign);
            updateToggle('theme-toggle-group', s.theme);
            
            Epubly.reader.applySettings(s);
        },
        handleUpdate(key, value) {
            const s = this.get();
            s[key] = value;
            if (key === 'theme') {
                localStorage.setItem('epubly-theme', value);
                // Force font color update based on theme
                if (value === 'light' || value === 'sepia') {
                    s.fontColor = '#1C1C1E';
                } else {
                    s.fontColor = '#F2F2F7';
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
                    request.onerror = e => reject("Hiba az adatbázis megnyitásakor.");
                    request.onblocked = e => reject("Az adatbázis zárolva van. Kérjük, zárja be az alkalmazás többi példányát, majd frissítse az oldalt.");
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
            Epubly.ui.showLoader();
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
        saveLocation(bookId, loc) { localStorage.setItem(`epubly-loc-${bookId}`, loc); }
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
                    const coverSrc = book.metadata.coverUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150" viewBox="0 0 100 150"><rect width="100" height="150" fill="%232c2c2e"/><text x="50" y="75" fill="%23555" font-family="sans-serif" font-size="12" text-anchor="middle">Nincs borító</text></svg>';
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
            // Sidebar buttons
            document.querySelectorAll('.close-sidebar').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetId = e.currentTarget.dataset.target;
                    Epubly.ui.toggleSidebar(targetId);
                });
            });
            
            document.querySelectorAll('.sidebar-tab').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const container = e.target.closest('.sidebar-tabs').parentElement;
                    container.querySelectorAll('.sidebar-tab').forEach(b => b.classList.remove('active'));
                    container.querySelectorAll('.sidebar-content > *, .wiki-content').forEach(l => l.classList.remove('active'));
                    e.target.classList.add('active');
                    document.getElementById(e.target.dataset.tab).classList.add('active');
                });
            });
            
            // Wiki Modal Tabs
            const wikiModal = document.getElementById('wiki-modal');
            if (wikiModal) {
                const tabs = wikiModal.querySelectorAll('.sidebar-tab[data-tab]');
                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        const targetId = tab.dataset.tab;
                        const targetContent = document.getElementById(targetId);

                        tabs.forEach(t => t.classList.remove('active'));
                        wikiModal.querySelectorAll('.wiki-content').forEach(c => c.classList.remove('active'));

                        tab.classList.add('active');
                        if (targetContent) {
                            targetContent.classList.add('active');
                        }
                    });
                });
            }

            document.getElementById('app-logo-btn').addEventListener('click', () => {
                Epubly.reader.updateSessionStats();
                Epubly.ui.showLibraryView();
            });

            // File Import
            const fileInput = document.getElementById('epub-file');
            if(fileInput) {
                fileInput.addEventListener('change', (e) => {
                    if(e.target.files.length > 0) {
                        Epubly.storage.handleFileUpload(e.target.files[0]);
                        e.target.value = '';
                    }
                });
            }
            const dropZone = document.getElementById('import-drop-zone');
            if (dropZone) {
                dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
                dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); });
                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dropZone.classList.remove('dragover');
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        Epubly.storage.handleFileUpload(e.dataTransfer.files[0]);
                        e.dataTransfer.clearData();
                    }
                });
            }

            // Modals
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

            // Highlights
            document.addEventListener('selectionchange', () => {
                const sel = window.getSelection();
                const menu = document.getElementById('highlight-menu');
                if(!sel.isCollapsed && sel.toString().trim().length > 1) {
                    const range = sel.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    menu.style.opacity = '1';
                    menu.style.pointerEvents = 'auto';
                    menu.style.top = (rect.bottom + window.scrollY + 10) + 'px';
                    menu.style.left = (Math.max(10, rect.left + window.scrollX)) + 'px'; 
                } else {
                    menu.style.opacity = '0';
                    menu.style.pointerEvents = 'none';
                }
            });
            
            document.querySelectorAll('.hl-color-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const color = e.target.dataset.color;
                    Epubly.highlights.add(color);
                });
            });

            // Search
            document.getElementById('btn-do-search').onclick = () => {
                const val = document.getElementById('search-input').value;
                Epubly.search.run(val);
            };
            
            // Generic click-outside-to-close for sidebars
            document.addEventListener('click', (e) => {
                const sidebars = document.querySelectorAll('.sidebar.visible');
                sidebars.forEach(sidebar => {
                    if (!sidebar.contains(e.target) && !e.target.closest('.toggle-sidebar-btn')) {
                        sidebar.classList.remove('visible');
                    }
                });
            });

            // Back Button
            document.getElementById('btn-nav-back').addEventListener('click', () => {
                Epubly.navigation.popState();
            });

            // --- Theme Toggle Logic ---
            this.updateThemeIcons(Epubly.settings.get().theme);
            document.getElementById('btn-theme-toggle').addEventListener('click', () => {
                const currentSettings = Epubly.settings.get();
                const newTheme = (currentSettings.theme === 'light' || currentSettings.theme === 'sepia') ? 'dark' : 'light';
                Epubly.settings.handleUpdate('theme', newTheme);
                this.updateThemeIcons(newTheme);
            });
            
            // Data Deletion
            document.getElementById('btn-delete-all').onclick = () => {
                if(confirm("FIGYELEM! Ez a gomb töröl minden könyvet, jegyzetet és beállítást. A művelet nem vonható vissza. Folytatod?")) {
                    localStorage.clear();
                    Epubly.storage.db.clearBooks().then(() => location.reload());
                }
            };

            document.getElementById('footer-year').textContent = `Epubly.hu v${version} © ${new Date().getFullYear()} Minden jog fenntartva.`;
        },
        
        updateThemeIcons(theme) {
            const sunIcon = document.getElementById('theme-icon-sun');
            const moonIcon = document.getElementById('theme-icon-moon');
            if (theme === 'light' || theme === 'sepia') {
                sunIcon.style.display = 'none';
                moonIcon.style.display = 'block';
                document.body.classList.add('theme-light'); 
            } else { // dark, terminal
                sunIcon.style.display = 'block';
                moonIcon.style.display = 'none';
                document.body.classList.remove('theme-light');
            }
        },

        toggleSidebar(id) {
            const sidebar = document.getElementById(id);
            if(!sidebar) return;
            const isVisible = sidebar.classList.contains('visible');
            document.querySelectorAll('.sidebar').forEach(el => el.classList.remove('visible'));
            if (!isVisible) sidebar.classList.add('visible');
        },

        showModal(id) { document.getElementById(id).classList.add('visible'); },
        hideModal(id) { document.getElementById(id).classList.remove('visible'); },
        
        showLoader() { 
            document.getElementById('loader').classList.remove('hidden');
            document.getElementById('loader-msg').textContent = "Betöltés...";
        },
        hideLoader() { document.getElementById('loader').classList.add('hidden'); },
        
        updateHeaderInfo(title, author, chapter) {
            document.getElementById('header-author').textContent = author || "";
            document.getElementById('header-title').textContent = title || "";
            document.getElementById('header-chapter').textContent = chapter ? `(${chapter})` : "";
            const sep = document.querySelector('.info-sep');
            if (sep) sep.style.display = author ? 'inline' : 'none';
        },
        
        updateBackButton() {
            const btn = document.getElementById('btn-nav-back');
            if(Epubly.state.history.length > 0) {
                btn.style.display = 'flex';
            } else {
                btn.style.display = 'none';
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
                <button class="icon-btn toggle-sidebar-btn" onclick="Epubly.ui.toggleSidebar('sidebar-toc')" title="Navigáció">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                <button class="icon-btn toggle-sidebar-btn" onclick="Epubly.ui.toggleSidebar('sidebar-settings')" title="Beállítások">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                </button>
            `;
        },
        showLibraryView() {
            document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
            document.getElementById('library-view').classList.add('active');
            this.updateHeaderInfo("Könyvtár", "", "");
            document.getElementById('reading-progress-fill').style.width = "0%";
            document.getElementById('btn-nav-back').style.display = 'none';
            
            const actions = document.getElementById('top-actions-container');
            actions.innerHTML = `
                <button class="btn btn-primary" onclick="Epubly.ui.showModal('import-modal')">Importálás</button>
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
            
            const readBtn = document.getElementById('btn-read-book');
            if (stats.progress > 0.01) {
                readBtn.textContent = 'FOLYTATÁS';
            } else {
                readBtn.textContent = 'OLVASÁS';
            }
            
            readBtn.onclick = async () => {
                this.hideModal('book-details-modal');
                Epubly.engine.loadBook(book.data, book.id);
            };
            document.getElementById('btn-show-toc').onclick = async () => {
                this.hideModal('book-details-modal');
                await Epubly.engine.loadBook(book.data, book.id);
                setTimeout(() => Epubly.ui.toggleSidebar('sidebar-toc'), 0);
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
        if (!window.JSZip) {
            throw new Error("A működéshez szükséges JSZip könyvtár nem töltődött be.");
        }
        if(!this.ui || !this.library || !this.settings || !this.storage) {
            throw new Error("Alkalmazás modulok hiányoznak. Az indítás sikertelen.");
        }

        this.ui.init();
        this.settings.init();
        this.lightbox.init();
        await this.storage.db.init();
        
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
