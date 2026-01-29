
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
                
                // 3. Render Logic for Immediate Backward Scroll
                if (idx > 0) {
                    // Load Previous chapter first (it will be at the top)
                    await Epubly.engine.renderChapter(idx - 1, 'append'); 
                    // Load Target chapter second (it will be below previous)
                    await Epubly.engine.renderChapter(idx, 'append');

                    // Scroll to the Target chapter (the second one)
                    const targetEl = document.querySelector(`.chapter-container[data-index="${idx}"]`);
                    if(targetEl) targetEl.scrollIntoView({ block: "start" });
                } else {
                    // If it's the very first chapter, just load it
                    await Epubly.engine.renderChapter(idx, 'clear');
                    document.getElementById('viewer').scrollTop = 0;
                }
                
                // 4. Ensure we have enough content to scroll (load next if needed)
                await Epubly.engine.ensureContentFillsScreen(idx);
                
                // 5. Re-init observers for the new content
                Epubly.engine.initObservers();
            };
        });
    },
    highlight(idx) {
        document.querySelectorAll('.toc-link').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
        });
    }
};
