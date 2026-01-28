
/**
 * Central State Store
 */
export const State = {
    zip: null,
    pdfDoc: null, // For PDF support
    currentFormat: null, // 'epub' or 'pdf'
    currentBookId: null,
    spine: [], 
    manifest: {}, 
    toc: [], 
    rootPath: '', 
    activeBookSessionStart: null,
    metadata: {},
    renderedChapters: new Set(),
    observer: null,
    isLoadingNext: false,
    isLoadingPrev: false,
    highlights: {},
    activeSidebar: null,
    history: [], 
    selectedHighlightId: null,
    ctxMenuHighlightId: null,
    currentPageInChapter: 1,
    totalPagesInChapter: 1,
    // PDF specific
    pdfScale: 2.0, // Render high res for clear zooming
    pdfLayout: 'fit-width', // 'fit-width' | 'fit-height'
    currentChapterPath: null
};
