
/**
 * Search Logic
 */
export const Search = {
    async run(query) {
        if(Epubly.state.currentFormat !== 'epub') {
            alert("A keresés jelenleg csak EPUB könyveknél érhető el.");
            return;
        }
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
};
