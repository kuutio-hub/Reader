
/**
 * Reader Style Applicator
 */
export const Reader = {
    updateSessionStats() {
        if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
        const now = Date.now();
        const duration = now - Epubly.state.activeBookSessionStart;
        Epubly.state.activeBookSessionStart = now;
        
        const progress = 0; 
        Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, progress);
    },

    applySettings(settings) {
        const viewer = document.getElementById('viewer-content');
        if(!viewer) return;
        
        const zoom = settings.globalZoom || 1.0;
        
        // Scroll mode only now
        const scrollMargin = settings.marginScroll || 10;
        const paddingLeft = `${scrollMargin}%`;
        const paddingRight = `${scrollMargin}%`;
        const verticalMargin = settings.marginVertical || 60;

        Object.assign(viewer.style, {
            fontFamily: settings.fontFamily,
            fontSize: `${settings.fontSize * zoom}%`,
            lineHeight: settings.lineHeight, 
            textAlign: settings.textAlign,
            fontWeight: settings.fontWeight,
            color: settings.fontColor,
            letterSpacing: `${settings.letterSpacing * zoom}px`,
            paddingLeft: paddingLeft,
            paddingRight: paddingRight,
            paddingTop: `${verticalMargin}px`,
            paddingBottom: `${verticalMargin}px`
        });
        
        document.body.className = `theme-${settings.theme}`;
        if (settings.theme === 'terminal') {
            document.body.style.setProperty('--terminal-color', settings.terminalColor);
        }

        document.body.classList.remove('view-mode-scroll', 'view-mode-paged', 'double-page');
        document.body.classList.add('view-mode-scroll');
        
        const scrollControl = document.getElementById('margin-scroll-control');
        const pagedControl = document.getElementById('margin-paged-control');
        const verticalControl = document.getElementById('margin-vertical-control');

        if (scrollControl) scrollControl.style.display = 'block';
        if (pagedControl) pagedControl.style.display = 'none';
        if (verticalControl) verticalControl.style.display = 'block';
    }
};
