
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
            link.onclick = () => {
                document.getElementById('viewer-content').innerHTML = '';
                Epubly.state.renderedChapters.clear();
                Epubly.engine.renderChapter(parseInt(link.dataset.idx), 'clear');
            };
        });
    },
    highlight(idx) {
        document.querySelectorAll('.toc-link').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
        });
    }
};
