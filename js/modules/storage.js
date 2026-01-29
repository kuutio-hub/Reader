
/**
 * IndexedDB & LocalStorage Management
 */
export const Storage = {
    db: null,

    async getDb() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('EpublyDB', 4);
            request.onerror = () => reject("IndexedDB error");
            request.onblocked = () => reject("Az adatbázis zárolva van. Kérjük, zárja be az alkalmazás többi példányát.");
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

    // Helper to convert Blob to Base64 String for persistence
    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    async handleFileUpload(file) {
        // Needs access to UI and Library which are globals in Epubly namespace
        Epubly.ui.showLoader();
        Epubly.ui.hideModal('import-modal');
        try {
            const allowedExtensions = ['.epub', '.pdf'];
            const fileName = file.name.toLowerCase();
            const isValid = allowedExtensions.some(ext => fileName.endsWith(ext));
            
            if (!isValid) throw new Error("Nem támogatott fájlformátum. Csak .epub vagy .pdf.");

            const arrayBuffer = await file.arrayBuffer();
            let metadata = { title: file.name, creator: "Ismeretlen" };
            let coverData = null; // Changed from coverUrl to coverData (Base64)
            let format = 'epub';

            if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
                format = 'pdf';
                metadata.title = file.name.replace('.pdf', '');
                metadata.creator = "PDF Dokumentum";
                
                // PDF Thumbnail (requires pdfjsLib global)
                if(window.pdfjsLib) {
                    try {
                        const pdfTask = pdfjsLib.getDocument(arrayBuffer.slice(0));
                        const pdf = await pdfTask.promise;
                        const page = await pdf.getPage(1);
                        const viewport = page.getViewport({ scale: 0.5 });
                        const canvas = document.createElement('canvas');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        const ctx = canvas.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport }).promise;
                        coverData = canvas.toDataURL(); // Canvas gives DataURL directly
                        try {
                            const meta = await pdf.getMetadata();
                            if (meta.info.Title) metadata.title = meta.info.Title;
                        } catch(e){}
                    } catch(e) { console.warn("PDF Thumbnail failed", e); }
                }
            } else {
                // EPUB Metadata (requires JSZip global + Utils)
                if(window.JSZip) {
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
                        if(coverFile) {
                            const blob = await coverFile.async("blob");
                            coverData = await this.blobToBase64(blob); // Save as Base64
                        }
                    }
                }
            }
            
            const bookId = `${Date.now()}`;
            await this.saveBook({
                id: bookId, 
                data: arrayBuffer, 
                format: format,
                metadata: {...metadata, coverUrl: coverData}, // Save base64 here
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
};
