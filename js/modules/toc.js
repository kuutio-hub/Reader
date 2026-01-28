
/**
 * Table of Contents
 */
export const TOC = {
    generate(tocItems) {
        const tocList = document.getElementById('toc-list');
        if(!tocList) return;
        tocList.innerHTML = !tocItems || tocItems.length === 0 
            ? '<li><span style="color:var(--text-muted); padding:8px; display:block;">Nincs tartalomjegyzék.</span></li>'
            : tocItems.map(item => `<li><a class="toc-link" data-idx="${item.index}">${item.label || "Fejezet " + (item.index + 1)}</a></li>`).join('');
        
        tocList.querySelectorAll('.toc-link').forEach(link => {
            link.onclick = async () => {
                const idx = parseInt(link.dataset.idx);
                Epubly.ui.toggleSidebar('sidebar-toc'); // Close sidebar on click
                
                // 1. Disconnect observer to prevent scroll triggers during clear
                if(Epubly.state.observer) Epubly.state.observer.disconnect();
                
                // 2. Clear content
                document.getElementById('viewer-content').innerHTML = '';
                Epubly.state.renderedChapters.clear();
                
                // 3. Render target chapter
                await Epubly.engine.renderChapter(idx, 'clear');
                
                // 4. Ensure we have enough content to scroll (prevents getting stuck on short chapters)
                await Epubly.engine.ensureContentFillsScreen(idx);
                
                // 5. Re-init observers for the new content
                Epubly.engine.initObservers();
                
                // 6. Reset scroll to top
                document.getElementById('viewer').scrollTop = 0;
            };
        });
    },
    highlight(idx) {
        document.querySelectorAll('.toc-link').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
        });
    }
};
