
/**
 * Reader Style Applicator
 */
export const Reader = {
    updateSessionStats(suspend = false) {
        if(!Epubly.state.currentBookId || !Epubly.state.activeBookSessionStart) return;
        const now = Date.now();
        const duration = now - Epubly.state.activeBookSessionStart;
        
        // Save if duration is realistic (> 1s and < 24h)
        // Pass 0 as progress to avoid overwriting existing progress with 0
        if (duration > 1000 && duration < 86400000) {
            Epubly.storage.updateBookStats(Epubly.state.currentBookId, duration, 0);
        }
        
        if (suspend) {
            Epubly.state.activeBookSessionStart = null;
        } else {
            Epubly.state.activeBookSessionStart = Date.now();
        }
    },

    applySettings(settings) {
        const viewer = document.getElementById('viewer-content');
        if(!viewer) return;
        
        this.tagSettingsDOM();

        const zoom = parseFloat(settings.globalZoom) || 1.0;
        
        // --- DYNAMIC MARGIN LOGIC ---
        // As zoom increases, margins disappear quickly to maximize screen space.
        let scrollMargin = parseFloat(settings.marginScroll) || 28;
        let reductionFactor = Math.max(0, 1 - (zoom - 1) * 2.5);
        let effectiveMargin = scrollMargin * reductionFactor;
        
        // Cap margin
        if (effectiveMargin > 45) effectiveMargin = 45;
        if (effectiveMargin < 0) effectiveMargin = 0;

        // --- DYNAMIC TYPOGRAPHY ---
        // Base Font Size scaled by zoom
        const finalFontSize = settings.fontSize * zoom;
        
        // Base Font Weight logic: 
        // As we zoom in ("get closer"), letters feel heavier/bolder naturally.
        // We add a slight weight increase based on zoom > 1.0
        let baseWeight = parseInt(settings.fontWeight) || 400;
        let dynamicWeight = baseWeight;
        if (zoom > 1.0) {
            // e.g. at 1.5x zoom, add ~50-100 to weight if possible
            dynamicWeight += Math.round((zoom - 1) * 100);
        }
        // Cap weight
        if(dynamicWeight > 900) dynamicWeight = 900;

        const paddingLeft = `${effectiveMargin}%`;
        const paddingRight = `${effectiveMargin}%`;
        const verticalMargin = 20; 

        Object.assign(viewer.style, {
            fontFamily: settings.fontFamily,
            fontSize: `${finalFontSize}%`,
            lineHeight: settings.lineHeight, 
            textAlign: settings.textAlign,
            fontWeight: dynamicWeight, // Apply dynamic weight
            color: settings.fontColor,
            letterSpacing: `${settings.letterSpacing * zoom}px`, // Scale spacing too
            paddingLeft: paddingLeft,
            paddingRight: paddingRight,
            paddingTop: `${verticalMargin}px`,
            paddingBottom: `${verticalMargin}px`,
            maxWidth: '100vw', // Prevent horizontal overflow
            overflowX: 'hidden' // Force hidden overflow
        });
        
        document.body.className = `theme-${settings.theme}`;
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
