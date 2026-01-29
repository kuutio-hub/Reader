
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
        
        const zoom = parseFloat(settings.globalZoom) || 1.0;
        
        // --- DYNAMIC MARGIN LOGIC (Fix for Browser Zoom) ---
        const marginValue = parseFloat(settings.marginScroll) || 28; // 0-40 from slider
        // Map slider value to a responsive percentage margin. Higher value = more margin.
        // Range: 5% (max width) to 35% (min width) margin on each side.
        let baseMarginPercent = 5 + (marginValue / 40) * 30;

        // When using the IN-APP zoom, reduce the margin to use screen space better.
        // This does not affect browser (Ctrl+wheel) zoom, which works correctly with percentages.
        const reductionFactor = Math.max(0, 1 - (zoom - 1) * 2);
        let effectiveMarginPercent = baseMarginPercent * reductionFactor;

        const finalFontSize = (settings.fontSize || 100) * zoom;
        const verticalMargin = 60; 

        // Apply styles
        Object.assign(viewer.style, {
            fontFamily: settings.fontFamily,
            fontSize: `${finalFontSize}%`,
            lineHeight: settings.lineHeight, 
            textAlign: settings.textAlign,
            fontWeight: settings.fontWeight,
            color: settings.fontColor,
            letterSpacing: `${settings.letterSpacing * zoom}px`,
            maxWidth: 'none', // This is the key fix for browser zoom.
            paddingTop: `${verticalMargin}px`,
            paddingBottom: `${verticalMargin}px`,
            paddingLeft: `${effectiveMarginPercent}%`,
            paddingRight: `${effectiveMarginPercent}%`,
        });
        
        // --- THEME & MODE ---
        document.body.className = `theme-${settings.theme}`;
        if (Epubly.state.currentFormat === 'pdf') {
             document.body.classList.add('mode-pdf');
        }

        if (settings.theme === 'terminal') {
            document.body.style.setProperty('--terminal-color', settings.terminalColor);
        }
    }
};
