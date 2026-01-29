
import { version } from '../../version.js';

/**
 * UI Controller
 */
export const UI = {
    dragState: { isDragging: false, startY: 0, startX: 0, startScrollTop: 0, startScrollLeft: 0 },

    init() {
        const fileInput = document.getElementById('epub-file');
        if(fileInput) {
            fileInput.addEventListener('change', (e) => {
                if(e.target.files.length > 0) Epubly.storage.handleFileUpload(e.target.files[0]);
            });
        }

        // --- GLOBAL CLICKS ---
        document.body.addEventListener('click', e => this.handleClick(e));

        // --- VISIBILITY API FOR TIME TRACKING ---
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === 'visible') {
                // Resume session if book is open
                if (Epubly.state.currentBookId) {
                    Epubly.state.activeBookSessionStart = Date.now();
                }
            } else {
                // Suspend session (save time, stop clock)
                if (Epubly.reader && Epubly.reader.updateSessionStats) {
                    Epubly.reader.updateSessionStats(true);
                }
            }
        });
        
        // Attempt to save on close
        window.addEventListener('beforeunload', () => {
             if (Epubly.reader && Epubly.reader.updateSessionStats) {
                Epubly.reader.updateSessionStats(true);
            }
        });

        // --- UNIFIED VIEWER CONTROLS (PDF & EPUB) ---
        const viewer = document.getElementById('viewer');
        if (viewer) {
            
            // 1. SCROLL & ZOOM & PAN (Wheel)
            viewer.addEventListener('wheel', (e) => {
                // CTRL + WHEEL = ZOOM
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (Epubly.state.currentFormat === 'pdf') {
                        // PDF Transform Zoom
                        const rect = viewer.getBoundingClientRect();
                        const mouseX = e.clientX - rect.left;
                        const mouseY = e.clientY - rect.top;
                        // Slower zoom step for PDF too
                        const delta = e.deltaY > 0 ? -0.05 : 0.05;
                        Epubly.engine.updatePDFZoom(delta, mouseX, mouseY);
                    } else {
                        // EPUB Font/CSS Zoom
                        const s = Epubly.settings.get();
                        let current = parseFloat(s.globalZoom);
                        // Much slower zoom step (0.025 instead of 0.1)
                        let next = e.deltaY > 0 ? current - 0.025 : current + 0.025;
                        next = Math.min(Math.max(0.8, next), 2.5); // limits
                        
                        // Update settings and UI range
                        Epubly.settings.handleUpdate('globalZoom', next.toFixed(3)); // 3 decimals for smooth storage
                        const range = document.getElementById('global-zoom-range');
                        if(range) range.value = next.toFixed(3);
                    }
                    return;
                }

                // ALT + WHEEL = HORIZONTAL SCROLL
                if (e.altKey) {
                    e.preventDefault();
                    if (Epubly.state.currentFormat === 'pdf') {
                         // Pan PDF X-axis. 
                         // deltaY positive = scroll right = move view right = content moves left (negative X)
                         Epubly.engine.panPDF(-e.deltaY, 0);
                    } else {
                        viewer.scrollLeft += e.deltaY;
                    }
                    return;
                }

                // DEFAULT: Vertical Scroll
                if (Epubly.state.currentFormat === 'pdf') {
                    // Manual vertical pan for PDF Canvas mode (since overflow is hidden)
                    e.preventDefault(); // Prevent page bounce
                    Epubly.engine.panPDF(0, -e.deltaY);
                } else {
                    // EPUB: Allow native scroll behavior
                    // No preventDefault() here
                }
            }, { passive: false });

            // 2. MOUSE DRAG (PANNING)
            viewer.addEventListener('mousedown', (e) => {
                // Middle click or Left click allowed
                if (e.button !== 0 && e.button !== 1) return;
                
                this.dragState.isDragging = true;
                this.dragState.startX = e.clientX;
                this.dragState.startY = e.clientY;
                this.dragState.startScrollTop = viewer.scrollTop;
                this.dragState.startScrollLeft = viewer.scrollLeft;
                
                // For PDF Transform Pan
                if (Epubly.state.currentFormat === 'pdf') {
                    Epubly.engine.pdfState.panning = true;
                    Epubly.engine.pdfState.startX = e.clientX;
                    Epubly.engine.pdfState.startY = e.clientY;
                }
                
                viewer.style.cursor = 'grabbing';
            });

            window.addEventListener('mousemove', (e) => {
                if (!this.dragState.isDragging) return;

                const deltaX = e.clientX - this.dragState.startX;
                const deltaY = e.clientY - this.dragState.startY;

                if (Epubly.state.currentFormat === 'pdf') {
                    // PDF: Update Transform
                    Epubly.engine.panPDF(deltaX, deltaY);
                    // Reset start to current to avoid compounding
                    this.dragState.startX = e.clientX;
                    this.dragState.startY = e.clientY;
                    Epubly.engine.pdfState.startX = e.clientX; 
                    Epubly.engine.pdfState.startY = e.clientY;
                } else {
                    // EPUB: Update Scroll
                    viewer.scrollTop = this.dragState.startScrollTop - deltaY;
                    viewer.scrollLeft = this.dragState.startScrollLeft - deltaX;
                }
            });

            window.addEventListener('mouseup', () => {
                this.dragState.isDragging = false;
                if (Epubly.state.currentFormat === 'pdf') {
                     Epubly.engine.pdfState.panning = false;
                }
                if(viewer) viewer.style.cursor = 'grab';
            });
        }

        const dropZone = document.getElementById('import-drop-zone');
         if(dropZone) {
            ['dragover', 'dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.toggle('dragover', ev === 'dragover');
                if (ev === 'drop') Epubly.storage.handleFileUpload(e.dataTransfer.files[0]);
            }));
        }
        
        this.injectQRCode();
        const footer = document.getElementById('footer-year');
        if(footer) footer.textContent = `Epubly v${version} © ${new Date().getFullYear()}`;
    },

    handleClick(e) {
        const target = e.target;
        const closest = (selector) => target.closest(selector);
        
        if (closest('.pdf-btn')) {
            const action = closest('.pdf-btn').dataset.action;
            this.handlePDFControl(action);
        }

        if (!closest('.sidebar') && !closest('.toggle-sidebar-btn')) {
            document.querySelectorAll('.sidebar.visible').forEach(sb => sb.classList.remove('visible'));
        }
        
        if (closest('.close-sidebar')) this.toggleSidebar(closest('.close-sidebar').dataset.target);
        if (closest('.sidebar-tab')) this.handleTabClick(target);
        
        if (closest('.wiki-nav-btn')) {
            const btn = closest('.wiki-nav-btn');
            const targetId = btn.dataset.target;
            document.querySelectorAll('.wiki-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.wiki-page').forEach(p => p.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
            
            // Check storage usage when opening About tab (if present there)
            if (targetId === 'wiki-about') {
                this.updateStorageStats();
            }
        }

        if (closest('#app-logo-btn')) { 
            Epubly.reader.updateSessionStats(true); // Suspend session
            Epubly.ui.showLibraryView(); 
        }
        
        if (closest('.modal-close')) closest('.modal').classList.remove('visible');
        if (target.classList.contains('modal')) target.classList.remove('visible');
        
        if (closest('#btn-do-search')) Epubly.search.run(document.getElementById('search-input').value);
        if (closest('#btn-theme-toggle')) this.toggleTheme();
        
        if (closest('#btn-fullscreen-toggle')) {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(e => {
                    console.warn("Fullscreen error", e);
                    alert("A teljes képernyős mód nem engedélyezett ezen az eszközön.");
                });
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
            }
        }
        
        if (closest('#btn-delete-all') && confirm("FIGYELEM! Ez a gomb töröl minden könyvet, jegyzetet és beállítást. A művelet nem vonható vissza. Folytatod?")) {
            localStorage.clear();
            Epubly.storage.clearBooks().then(() => location.reload());
        }
        if (closest('#floating-back-btn')) Epubly.navigation.popState();
    },

    async updateStorageStats() {
        const el = document.getElementById('storage-usage');
        if (!el) return;
        
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
                el.innerHTML = `<strong>Tárhely használat:</strong> ${usedMB} MB`;
            } catch (e) {
                el.innerHTML = "Tárhely info nem elérhető.";
            }
        } else {
             el.innerHTML = "Tárhely info nem támogatott.";
        }
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
        const nextTheme = s.theme === 'dark' ? 'sepia' : 'dark';
        Epubly.settings.handleUpdate('theme', nextTheme);
        this.updateThemeIcons(nextTheme);
    },

    updateThemeIcons(theme) {
        const sun = document.getElementById('theme-icon-sun');
        const moon = document.getElementById('theme-icon-moon');
        if(sun && moon) {
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
            if(!sidebar.classList.contains('visible')) {
                document.querySelectorAll('.sidebar.visible').forEach(sb => sb.classList.remove('visible'));
            }
            sidebar.classList.toggle('visible');
        }
    },

    showModal(id) { 
        document.getElementById(id)?.classList.add('visible'); 
        if(id === 'wiki-modal') this.updateStorageStats(); // Auto update on open if elements visible
    },
    hideModal(id) { document.getElementById(id)?.classList.remove('visible'); },
    
    showLoader() { document.getElementById('loader')?.classList.remove('hidden'); },
    hideLoader() { document.getElementById('loader')?.classList.add('hidden'); },
    
    updateHeaderInfo(title, author, chapter) {
        const set = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
        set('header-author', author || "");
        set('header-title', title || "");
        set('header-chapter', "");
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
        if (action === 'fit-width') {
             Epubly.engine.pdfState.scale = 1;
             Epubly.engine.pdfState.pointX = 0;
             Epubly.engine.pdfState.pointY = 0;
             Epubly.engine.renderPDFView();
        } else if (action === 'fit-height') {
             Epubly.engine.pdfState.scale = 0.6;
             Epubly.engine.pdfState.pointX = 0;
             Epubly.engine.pdfState.pointY = 0;
             Epubly.engine.renderPDFView();
        } else if (action === 'zoom-in') {
            Epubly.engine.updatePDFZoom(0.2);
        } else if (action === 'zoom-out') {
            Epubly.engine.updatePDFZoom(-0.2);
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
        document.body.classList.remove('mode-pdf');
        document.getElementById('library-view')?.classList.add('active');
        this.updateHeaderInfo("Könyvtár", "", "");
        this.showFloatingBackButton(false);
        this.togglePDFControls(false); 
        const actions = document.getElementById('top-actions-container');
        if(actions) actions.innerHTML = ``;
        
        // Explicitly clear tracking state
        Epubly.state.currentBookId = null;
        Epubly.state.activeBookSessionStart = null;
        
        Epubly.library.render();
    },

    showBookInfoModal(bookOrId) {
        let book;
        if (typeof bookOrId === 'object') {
            book = bookOrId;
            this._renderBookInfoModal(book);
        } else {
            Epubly.storage.getBook(bookOrId).then(b => {
                if(b) this._renderBookInfoModal(b);
            });
        }
    },

    _renderBookInfoModal(book) {
        const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        const img = document.getElementById('detail-cover-img');
        if(img) img.src = book.metadata.coverUrl || Epubly.library.generateCover(book.metadata.title, book.metadata.creator);
        
        set('detail-title', book.metadata.title);
        set('detail-author', book.metadata.creator);
        const desc = document.getElementById('detail-desc');
        if(desc) {
            if (book.metadata.description) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(book.metadata.description, 'text/html');
                doc.body.querySelectorAll('*').forEach(el => {
                    el.removeAttribute('style'); el.removeAttribute('class'); el.removeAttribute('color'); el.removeAttribute('face');
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
        
        document.getElementById('btn-read-book').onclick = () => { this.hideModal('book-details-modal'); Epubly.engine.loadBook(book.data, book.id, book.format); };
        
        const btnToc = document.getElementById('btn-show-toc');
        if(btnToc) btnToc.onclick = async () => { this.hideModal('book-details-modal'); await Epubly.engine.loadBook(book.data, book.id, book.format); this.toggleSidebar('sidebar-toc'); };
        
        document.getElementById('btn-delete-book').onclick = async () => { 
            if(confirm('Biztosan törlöd?')) { 
                await Epubly.storage.deleteBook(book.id); 
                this.hideModal('book-details-modal'); 
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
        const mohuCode = "d0a663f6-b055-40e8-b3d5-399236cb6b94"; 

        containers.forEach(item => {
            const el = document.getElementById(item.id);
            if(el && window.QRCode) {
                el.innerHTML = ''; 
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
    },

    delayedPrint() {
        // Simple trick to let the browser render the DOM before opening the print dialog
        setTimeout(() => {
            window.print();
        }, 500);
    }
};
