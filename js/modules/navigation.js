
/**
 * Navigation & History
 */
export const Navigation = {
    pushState() {
        const viewer = document.getElementById('viewer');
        let scrollTop = viewer.scrollTop;
        let scrollLeft = viewer.scrollLeft;
        let currentIdx = 0;

        if (Epubly.state.currentFormat === 'epub') {
            let firstVisibleChapter = document.querySelector('.chapter-container');
            if (firstVisibleChapter) currentIdx = parseInt(firstVisibleChapter.dataset.index) || 0;
        }
        
        Epubly.state.history.push({
            chapterIndex: currentIdx,
            scrollTop: scrollTop,
            scrollLeft: scrollLeft
        });
        Epubly.ui.showFloatingBackButton(false);
    },
    
    popState() {
        if(Epubly.state.history.length === 0) return;
        const state = Epubly.state.history.pop();
        
        if (Epubly.state.history.length === 0) Epubly.ui.showFloatingBackButton(false);
        
        if (Epubly.state.currentFormat === 'epub') {
            // Force reload of that specific chapter state
            document.getElementById('viewer-content').innerHTML = '';
            Epubly.state.renderedChapters.clear();
            
            Epubly.engine.renderChapter(state.chapterIndex, 'clear').then(() => {
                const viewer = document.getElementById('viewer');
                // Use stabilization logic here too
                Epubly.engine.stabilizeScroll(state.scrollTop);
            });
        } else {
            // PDF Restore
            const viewer = document.getElementById('viewer');
            viewer.scrollTop = state.scrollTop;
        }
    },

    handleLinkClick(e) {
        const link = e.target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href');
        if (!href) return;

        if (href.startsWith('http')) {
            e.preventDefault();
            window.open(href, '_blank');
            return;
        }

        e.preventDefault();
        
        // 1. Save current position BEFORE navigating away
        this.pushState();

        if (Epubly.state.currentFormat === 'epub') {
            const [path, hash] = href.split('#');
            // Resolve path relative to current chapter
            const targetPath = Epubly.engine.resolvePath(Epubly.state.currentChapterPath, path);
            
            let targetIndex = Epubly.state.spine.findIndex(s => s.fullPath === targetPath);

            if (targetIndex !== -1) {
                const isSameChapter = Array.from(Epubly.state.renderedChapters).includes(targetIndex);
                
                if (isSameChapter && hash) {
                    this.scrollToHash(hash);
                } else {
                    // Different chapter (e.g. Footnotes at end of book)
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(targetIndex, 'clear').then(() => {
                        if (hash) {
                            // Wait a tiny bit for render to settle
                            setTimeout(() => this.scrollToHash(hash), 100);
                        } else {
                            document.getElementById('viewer').scrollTop = 0;
                        }
                    });
                }
            } else {
                console.warn("Could not find target for:", href);
            }
        }
        Epubly.ui.showFloatingBackButton(true);
    },

    scrollToHash(hash) {
        if (!hash) return;
        const target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
        if (target) {
            // Calculate position including header offset
            const headerOffset = 60;
            const elementPosition = target.getBoundingClientRect().top;
            const offsetPosition = elementPosition + document.getElementById('viewer').scrollTop - headerOffset;

            document.getElementById('viewer').scrollTo({
                top: offsetPosition,
                behavior: "smooth"
            });
            
            // Highlight effect for footnotes
            target.style.transition = 'background 0.5s';
            target.style.backgroundColor = 'var(--brand-dim)';
            setTimeout(() => { target.style.backgroundColor = 'transparent'; }, 2000);
        }
    }
};
