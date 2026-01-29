
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
        
        // Add classes to settings sidebar DOM elements for filtering in PDF mode
        this.tagSettingsDOM();

        const zoom = parseFloat(settings.globalZoom) || 1.0;
        
        // INVERTED MARGIN LOGIC
        // Base margin is from slider (e.g., 28%).
        // If Zoom > 1 (Getting closer), margin should shrink.
        // If Zoom < 1 (Moving away), margin should grow.
        // Formula: baseMargin / zoom
        
        let scrollMargin = parseFloat(settings.marginScroll) || 28;
        let effectiveMargin = scrollMargin / zoom; 
        
        // Cap margin to prevent text disappearing
        if (effectiveMargin > 45) effectiveMargin = 45;
        if (effectiveMargin < 0) effectiveMargin = 0;

        const paddingLeft = `${effectiveMargin}%`;
        const paddingRight = `${effectiveMargin}%`;
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
        // Preserve PDF Mode class if set
        if (Epubly.state.currentFormat === 'pdf') {
             document.body.classList.add('mode-pdf');
        }

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
        if (verticalControl) verticalControl.style.display = 'none';
    },

    tagSettingsDOM() {
        // Helper to add 'setting-item-typography' class to relevant divs in sidebar
        const ids = [
            'font-family-select', 'font-size-range', 'font-weight-range', 
            'line-height-range', 'letter-spacing-range', 'margin-scroll-range',
            'global-zoom-range', 'align-toggle-group'
        ];
        
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const wrapper = el.closest('.setting-item');
                if (wrapper) wrapper.classList.add('setting-item-typography');
            }
        });
    }
};
