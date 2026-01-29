
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
        
        const zoom = parseFloat(settings.globalZoom) || 1.0;
        
        // Scale margin with zoom
        let scrollMargin = parseFloat(settings.marginScroll) || 10;
        
        // Ensure margin doesn't become negative or too small if zoomed way out, 
        // but respect user setting primarily.
        // We multiply by zoom to give "More space" when zoomed in, or maintain ratio.
        // Actually, for margins, users usually want them fixed %, but let's scale it slightly
        // or just apply as is. User asked: "globális zoomnál a margót is állítsuk"
        // Interpreted as: Zoom affects margin size.
        let effectiveMargin = scrollMargin * zoom; 

        // Cap margin at 40% to prevent unreadable text
        if (effectiveMargin > 40) effectiveMargin = 40;

        const paddingLeft = `${effectiveMargin}%`;
        const paddingRight = `${effectiveMargin}%`;
        
        // Vertical margin removed/minimized
        const verticalMargin = 20; 

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
        
        // Update PDF Zoom if PDF is active
        if (Epubly.state.currentFormat === 'pdf') {
             // Logic in Engine will read settings if needed, but PDF mostly uses own controls
        }
        
        const scrollControl = document.getElementById('margin-scroll-control');
        const pagedControl = document.getElementById('margin-paged-control');
        const verticalControl = document.getElementById('margin-vertical-control');

        if (scrollControl) scrollControl.style.display = 'block';
        if (pagedControl) pagedControl.style.display = 'none';
        if (verticalControl) verticalControl.style.display = 'none';
    }
};
