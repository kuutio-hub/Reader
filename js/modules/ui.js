import { version } from '../../version.js';

/**
 * UI Controller
 */
export const UI = {
    dragState: { isDragging: false, startY: 0, startX: 0, startScrollTop: 0, startScrollLeft: 0 },
    isMobile: window.innerWidth <= 768,

    init() {
        // Initial setup
        this.setupHeader();
        this.setupEventListeners();
        
        // Final UI text setup
        this.injectQRCode();
        const footer = document.getElementById('footer-year');
        if(footer) footer.textContent = `Epubly v${version} © ${new Date().getFullYear()}`;
    },

    setupEventListeners() {
        const fileInput = document.getElementById('epub-file');
        if(fileInput) {
            fileInput.addEventListener('change', (e) => {
                if(e.target.files.length > 0) Epubly.storage.handleFileUpload(e.target.files[0]);
            });
        }
        
        document.body.addEventListener('click', e => this.handleClick(e));
        
        // Handle window resize for adaptive UI
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => this.setupHeader(), 100);
        });

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === 'visible') {
                if (Epubly.state.currentBookId) Epubly.state.activeBookSessionStart = Date.now();
            } else {
                if (Epubly.reader && Epubly.reader.updateSessionStats) Epubly.reader.updateSessionStats(true);
            }
        });
        
        window.addEventListener('beforeunload', () => {
             if (Epubly.reader && Epubly.reader.updateSessionStats) Epubly.reader.updateSessionStats(true);
        });
        
        // Listen for fullscreen changes to update icon
        document.addEventListener('fullscreenchange', () => this.updateFullscreenIcons());

        this.setupViewerControls();

        const dropZone = document.getElementById('import-drop-zone');
        if(dropZone) {
            ['dragover', 'dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.toggle('dragover', ev === 'dragover');
                if (ev === 'drop') Epubly.storage.handleFileUpload(e.dataTransfer.files[0]);
            }));
        }
    },

    setupHeader() {
        this.isMobile = window.innerWidth <= 768;
        const desktopControls = document.getElementById('desktop-controls');
        const mobileControlsContainer = document.getElementById('mobile-controls-container');

        if (!desktopControls || !mobileControlsContainer) return;

        // Always clear mobile container first
        mobileControlsContainer.innerHTML = '';
        
        if (this.isMobile) {
             // Clone all controls from desktop to the mobile panel
             // This keeps a single source of truth in the HTML
            Array.from(desktopControls.children).forEach(child => {
                 if (child.id === 'top-actions-container') {
                     // If there are reader-specific buttons, clone them too
                     Array.from(child.children).forEach(actionBtn => {
                         mobileControlsContainer.appendChild(actionBtn.cloneNode(true));
                     });
                 } else {
                     mobileControlsContainer.appendChild(child.cloneNode(true));
                 }
            });

        } else {
             // Ensure panel is closed on resize to desktop
            document.getElementById('burger-menu-panel')?.classList.remove('visible');
        }
        this.updateFullscreenIcons();
    },
    
    toggleBurgerMenu() {
        document.getElementById('burger-menu-panel')?.classList.toggle('visible');
    },
    
    setupViewerControls() {
        // This function can be expanded with viewer-specific controls if needed
    },

    handleClick(e) {
        const target = e.target;
        const closest = (selector) => target.closest(selector);

        // Burger Menu auto-close logic
        const panel = document.getElementById('burger-menu-panel');
        if (panel && panel.classList.contains('visible') && !closest('#burger-menu-panel') && !closest('#burger-btn')) {
            this.toggleBurgerMenu();
        }

        if (closest('#burger-btn')) this.toggleBurgerMenu();
        
        if (closest('.pdf-btn')) this.handlePDFControl(closest('.pdf-btn').dataset.action);
        
        if (!closest('.sidebar') && !closest('.toggle-sidebar-btn')) document.querySelectorAll('.sidebar.visible').forEach(sb => sb.classList.remove('visible'));
        
        if (closest('.close-sidebar')) this.toggleSidebar(closest('.close-sidebar').dataset.target);
        if (closest('.sidebar-tab')) this.handleTabClick(target);
        if (closest('#btn-help')) this.showModal('wiki-modal');
        if (closest('.wiki-nav-btn')) this.handleWikiNav(closest('.wiki-nav-btn'));
        
        const wikiSelect = document.getElementById('wiki-nav-select');
        if (target === wikiSelect) this.handleWikiNav(target);

        if (closest('#app-logo-btn')) { 
            if(Epubly.reader.updateSessionStats) Epubly.reader.updateSessionStats(true);
            this.showLibraryView(); 
        }
        
        if (closest('.modal-close')) {
            closest('.modal').classList.remove('visible');
            // Reset description view if closing the book details modal
            if (closest('.modal').id === 'book-details-modal') {
                document.querySelector('.book-detail-layout')?.classList.remove('desc-focused');
            }
        }

        if (target.classList.contains('modal')) {
             target.classList.remove('visible');
              if (target.id === 'book-details-modal') {
                document.querySelector('.book-detail-layout')?.classList.remove('desc-focused');
            }
        }
        
        if (closest('#btn-do-search')) Epubly.search.run(document.getElementById('search-input').value);
        if (closest('#btn-theme-toggle')) this.toggleTheme();
        
        if (closest('#btn-fullscreen-toggle')) this.toggleFullscreen();
        
        if (closest('#btn-delete-all') && confirm("FIGYELEM! Ez a gomb töröl minden könyvet és beállítást. Folytatod?")) {
            localStorage.clear();
            Epubly.storage.clearBooks().then(() => location.reload());
        }
        if (closest('#floating-back-btn')) Epubly.navigation.popState();
    },

    handleWikiNav(target) {
        const isSelect = target.tagName === 'SELECT';
        const targetId = isSelect ? target.value : target.dataset.target;

        if (isSelect) {
            // No visual active state for select options, just switch content
        } else {
            document.querySelectorAll('.wiki-nav-btn').forEach(b => b.classList.remove('active'));
            target.classList.add('active');
        }
        
        document.querySelectorAll('.wiki-page').forEach(p => p.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    },
    
    updateFullscreenIcons() {
        const isFullscreen = !!document.fullscreenElement;
        
        const updateIconsInContainer = (container) => {
            const enterIcon = container.querySelector('#fullscreen-enter-icon');
            const exitIcon = container.querySelector('#fullscreen-exit-icon');
            if (enterIcon && exitIcon) {
                enterIcon.style.display = isFullscreen ? 'none' : 'block';
                exitIcon.style.display = isFullscreen ? 'block' : 'none';
            }
        };

        const desktopContainer = document.getElementById('desktop-controls');
        const mobileContainer = document.getElementById('mobile-controls-container');
        
        if(desktopContainer) updateIconsInContainer(desktopContainer);
        if(mobileContainer) updateIconsInContainer(mobileContainer);
    },

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                alert(`Hiba a teljes képernyős mód aktiválásakor: ${err.message}`);
            });
        } else if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    },

    async updateStorageStats() {
        const el = document.getElementById('storage-usage');
        if (!el) return;
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
                el.innerHTML = `<strong>Tárhely használat:</strong> ${usedMB} MB`;
            } catch (e) { el.innerHTML = "Tárhely info nem elérhető."; }
        } else { el.innerHTML = "Tárhely info nem támogatott."; }
    },

    handleTabClick(tab) {
        const container = tab.closest('.sidebar');
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
                sun.style.display = 'none'; moon.style.display = 'block';
            } else {
                sun.style.display = 'block'; moon.style.display = 'none';
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
        if(id === 'wiki-modal') this.updateStorageStats();
    },
    hideModal(id) { document.getElementById(id)?.classList.remove('visible'); },
    
    showLoader() { document.getElementById('loader')?.classList.remove('hidden'); },
    hideLoader() { document.getElementById('loader')?.classList.add('hidden'); },
    
    updateHeaderInfo(title, author, chapter) {
        const set = (id, text) => { const el = document.getElementById(id); if(el) el.textContent = text; };
        set('header-author', author || "");
        set('header-title', title || "");
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
        // Placeholder for PDF controls
    },
    
    showReaderView() {
        document.body.classList.add('in-reader-mode');
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById('reader-view')?.classList.add('active');
        
        const actionsContainer = document.getElementById('top-actions-container');
        if(actionsContainer) {
            actionsContainer.innerHTML = `
                <button class="icon-btn" onclick="Epubly.ui.showModal('search-modal')" title="Keresés"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" fill="currentColor"/></svg></button>
                <button class="icon-btn toggle-sidebar-btn" onclick="Epubly.ui.toggleSidebar('sidebar-toc')" title="Navigáció"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" fill="currentColor"/></svg></button>
                <button class="icon-btn toggle-sidebar-btn" onclick="Epubly.ui.toggleSidebar('sidebar-settings')" title="Beállítások"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" fill="currentColor"/></svg></button>
            `;
        }
        this.setupHeader(); // Re-run header setup to populate mobile menu if needed
    },

    showLibraryView() {
        document.body.classList.remove('in-reader-mode');
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.body.classList.remove('mode-pdf');
        document.getElementById('library-view')?.classList.add('active');
        this.updateHeaderInfo("Könyvtár", "", "");
        this.showFloatingBackButton(false);
        this.togglePDFControls(false); 
        const actionsContainer = document.getElementById('top-actions-container');
        if(actionsContainer) actionsContainer.innerHTML = '';
        
        Epubly.state.currentBookId = null;
        Epubly.state.activeBookSessionStart = null;
        this.setupHeader();
        Epubly.library.render();
    },

    showBookInfoModal(book) {
        // Reset description view state every time modal is shown
        const layout = document.querySelector('#book-details-modal .book-detail-layout');
        if (layout) {
            layout.classList.remove('desc-focused');
        }
        this._renderBookInfoModal(book);
    },

    _renderBookInfoModal(book) {
        const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
        const img = document.getElementById('detail-cover-img');
        if(img) img.src = book.metadata.coverUrl || Epubly.library.generateCover(book.metadata.title, book.metadata.creator);
        
        set('detail-title', book.metadata.title);
        set('detail-author', book.metadata.creator);
        
        const descDiv = document.getElementById('detail-desc');
        if(descDiv) {
            if (book.metadata.description) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(book.metadata.description, 'text/html');
                doc.body.querySelectorAll('*').forEach(el => el.removeAttribute('style'));
                descDiv.innerHTML = doc.body.innerHTML;
            } else {
                descDiv.innerHTML = "Leírás nem elérhető.";
            }
        }
        
        const stats = book.stats || { totalTime: 0, progress: 0 };
        const minutes = Math.floor(stats.totalTime / 60000);
        set('detail-stats-time', `${Math.floor(minutes/60)}ó ${minutes%60}p`);
        set('detail-stats-prog', `${Math.round((stats.progress || 0) * 100)}%`);
        
        document.getElementById('btn-read-book').textContent = stats.progress > 0.01 ? 'FOLYTATÁS' : 'OLVASÁS';
        
        // --- EVENT HANDLERS ---
        document.getElementById('btn-read-book').onclick = () => { this.hideModal('book-details-modal'); Epubly.engine.loadBook(book.data, book.id, book.format); };
        
        const layout = document.querySelector('#book-details-modal .book-detail-layout');
        const toggleDescBtn = document.getElementById('toggle-desc-btn');
        const backFromDescBtn = document.getElementById('btn-back-from-desc');
        
        if(layout && toggleDescBtn && backFromDescBtn) {
            toggleDescBtn.onclick = () => {
                layout.classList.add('desc-focused');
            };
            backFromDescBtn.onclick = () => {
                layout.classList.remove('desc-focused');
            };
        }

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
            { id: 'mohu-qr-container', size: 80, text: "d0a663f6-b055-40e8-b3d5-399236cb6b94" },
            { id: 'print-qr-container', size: 90, text: "d0a663f6-b055-40e8-b3d5-399236cb6b94" },
            { id: 'mobile-qr-target', size: 250, text: "d0a663f6-b055-40e8-b3d5-399236cb6b94" },
            { id: 'revolut-qr', size: 160, text: "https://revolut.me/hrvthgrgly" },
            { id: 'paypal-qr', size: 160, text: "https://www.paypal.com/qrcodes/managed/62bb969f-4f6e-48ad-9796-9cb14b1fa07a?utm_source=consapp_download" }
        ];

        containers.forEach(item => {
            const el = document.getElementById(item.id);
            if(el && window.QRCode) {
                el.innerHTML = ''; 
                try {
                    new QRCode(el, {
                        text: item.text, width: item.size, height: item.size,
                        colorDark : "#000000", colorLight : "#ffffff",
                        correctLevel : QRCode.CorrectLevel.H
                    });
                } catch (e) { console.error("QR Generation failed:", e); }
            }
        });
    },

    delayedPrint() {
        setTimeout(() => window.print(), 500);
    }
};
