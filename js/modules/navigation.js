
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
        Epubly.ui.showFloatingBackButton(false);
        
        if (Epubly.state.currentFormat === 'epub') {
            document.getElementById('viewer-content').innerHTML = '';
            Epubly.state.renderedChapters.clear();
            Epubly.engine.renderChapter(state.chapterIndex, 'clear').then(() => {
                const viewer = document.getElementById('viewer');
                setTimeout(() => {
                    viewer.scrollTop = state.scrollTop;
                    viewer.scrollLeft = state.scrollLeft || 0;
                }, 50);
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
        this.pushState();

        if (Epubly.state.currentFormat === 'epub') {
            const [path, hash] = href.split('#');
            // Assuming Epubly.engine.resolvePath maps to Utils.resolvePath
            const targetPath = Epubly.engine.resolvePath(Epubly.state.currentChapterPath, path);
            
            let targetIndex = Epubly.state.spine.findIndex(s => s.fullPath === targetPath);

            if (targetIndex !== -1) {
                const isSameChapter = Array.from(Epubly.state.renderedChapters).includes(targetIndex);
                if (isSameChapter && hash) {
                    this.scrollToHash(hash);
                } else {
                    document.getElementById('viewer-content').innerHTML = '';
                    Epubly.state.renderedChapters.clear();
                    Epubly.engine.renderChapter(targetIndex, 'clear').then(() => {
                        if (hash) this.scrollToHash(hash);
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
        setTimeout(() => {
            const target = document.getElementById(hash) || document.querySelector(`[name="${hash}"]`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    },

    turnPage(direction) {
        const viewer = document.getElementById('viewer');
        const pageWidth = viewer.clientWidth;
        const scrollWidth = viewer.scrollWidth;
        const currentScroll = Math.ceil(viewer.scrollLeft);
        
        if (direction === 'next') {
            if (currentScroll + pageWidth < scrollWidth - 10) { 
                viewer.scrollBy({ left: pageWidth, behavior: 'smooth' });
            } else {
                if (Epubly.state.currentFormat === 'epub') {
                    const lastIdx = Math.max(...Epubly.state.renderedChapters);
                    if (lastIdx < Epubly.state.spine.length - 1) {
                        document.getElementById('viewer-content').innerHTML = '';
                        Epubly.state.renderedChapters.clear();
                        Epubly.engine.renderChapter(lastIdx + 1, 'clear').then(() => {
                            viewer.scrollLeft = 0;
                        });
                    }
                }
            }
        } else { // prev
            if (currentScroll > 10) {
                viewer.scrollBy({ left: -pageWidth, behavior: 'smooth' });
            } else {
                if (Epubly.state.currentFormat === 'epub') {
                    const firstIdx = Math.min(...Epubly.state.renderedChapters);
                    if (firstIdx > 0) {
                        document.getElementById('viewer-content').innerHTML = '';
                        Epubly.state.renderedChapters.clear();
                        Epubly.engine.renderChapter(firstIdx - 1, 'clear').then(() => {
                            setTimeout(() => {
                                viewer.scrollLeft = viewer.scrollWidth;
                            }, 100);
                        });
                    }
                }
            }
        }
        
        setTimeout(Epubly.engine.updatePageCounts, 300);
    }
};
