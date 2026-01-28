
import { version } from './version.js';
import { State } from './js/modules/state.js';
import { Debug, Utils } from './js/modules/utils.js';
import { Storage } from './js/modules/storage.js';
import { Settings } from './js/modules/settings.js';
import { UI } from './js/modules/ui.js';
import { Library } from './js/modules/library.js';
import { Engine } from './js/modules/engine.js';
import { Navigation } from './js/modules/navigation.js';
import { Search } from './js/modules/search.js';
import { Reader } from './js/modules/reader_settings.js';
import { TOC } from './js/modules/toc.js';

// --- DEBUGGER ---
Debug.init();

// --- MAIN ORCHESTRATOR ---
const Epubly = {
    state: State,
    storage: Storage,
    settings: Settings,
    ui: UI,
    library: Library,
    engine: Engine,
    navigation: Navigation,
    search: Search,
    reader: Reader,
    toc: TOC,
    
    // Core Init
    async init() {
        if (!window.JSZip) {
            throw new Error("A működéshez szükséges JSZip könyvtár nem töltődött be.");
        }
        
        // Modules init sequence
        this.ui.init();
        this.settings.init();
        
        // Lightbox logic (inline for simplicity or could be moved to UI)
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

        await this.storage.getDb();
        
        this.ui.showLibraryView();
        this.ui.hideLoader();
        
        console.log(`Epubly v${version} Initialized (Modular).`);
    }
};

// Expose Global Namespace
window.Epubly = Epubly;

// Start App
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await Epubly.init();
    } catch (error) {
        console.error("Fatal init error:", error);
        const loader = document.getElementById('loader');
        const errorDiv = document.getElementById('loader-error');
        const retryBtn = document.getElementById('retry-btn');
        
        if (loader) loader.classList.remove('hidden');
        if (errorDiv) {
            errorDiv.textContent = `Hiba történt az alkalmazás indításakor: ${error.message}`;
            errorDiv.style.display = 'block';
        }
        document.getElementById('loader-msg').style.display = 'none';
        document.querySelector('#loader .spinner').style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'block';
    }
});
