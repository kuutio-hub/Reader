
/**
 * Library & Cover Generation
 */
export const Library = {
    generateCover(title, author) {
        let hash = 0;
        const str = title + author;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        
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
        
        const importCard = document.createElement('div');
        importCard.className = 'import-card';
        importCard.onclick = () => Epubly.ui.showModal('import-modal');
        
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
            card.onclick = () => Epubly.ui.showBookInfoModal(book);
            
            // Fix: coverUrl is now a base64 string from DB, so it works offline/reload
            const coverSrc = book.metadata.coverUrl || this.generateCover(book.metadata.title, book.metadata.creator);
            
            card.innerHTML = `
                <div class="book-cover"><img src="${coverSrc}" alt="${book.metadata.title}" loading="lazy"></div>
                <div class="book-title" title="${book.metadata.title}">${book.metadata.title || "Ismeretlen"}</div>
                <div class="book-author" title="${book.metadata.creator}">${book.metadata.creator || "Ismeretlen"}</div>
            `;
            grid.appendChild(card);
        });
    }
};
