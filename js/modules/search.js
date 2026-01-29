
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
                const rawText = await file.async("string");
                const text = rawText.replace(/<[^>]*>/g, ' '); 
                
                if(text.toLowerCase().includes(q)) {
                    count++;
                    const idx = text.toLowerCase().indexOf(q);
                    const snippetShort = text.substring(Math.max(0, idx - 40), idx + 40);
                    const snippetLong = text.substring(Math.max(0, idx - 150), idx + 150);
                    
                    const item = document.createElement('div');
                    item.className = 'search-result-item';
                    item.innerHTML = `
                        <div style="font-weight:bold; font-size:0.8rem; color:var(--brand);">Fejezet ${i + 1}</div>
                        <div class="search-snippet" style="font-size:0.9rem; color:var(--text-muted); line-height:1.4;">
                            ...${snippetShort.replace(new RegExp(query, 'gi'), m => `<span style="background:var(--brand-dim); color:var(--brand);">${m}</span>`)}...
                        </div>
                        <div class="search-actions">
                            <button class="btn btn-small btn-primary action-jump">Ugrás</button>
                        </div>
                    `;
                    
                    // Simple hover effect is handled by CSS (showing actions)
                    // Click handler for Jump
                    item.querySelector('.action-jump').onclick = (e) => {
                        e.stopPropagation();
                        Epubly.ui.hideModal('search-modal');
                        document.getElementById('viewer-content').innerHTML = '';
                        Epubly.state.renderedChapters.clear();
                        Epubly.engine.renderChapter(i, 'clear');
                    };
                    
                    // Click on body expands/shows context if needed, but for now simple Jump is fine
                    item.onclick = item.querySelector('.action-jump').onclick;

                    resultsDiv.appendChild(item);
                    if(count > 50) break; 
                }
            }
        }
        document.getElementById('search-status').style.display = 'none';
        if(count === 0) resultsDiv.innerHTML = '<p style="text-align:center; padding:20px;">Nincs találat.</p>';
    }
};
