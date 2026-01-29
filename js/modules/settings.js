
/**
 * Settings & Theme Management
 */
export const Settings = {
    init() {
        this.load();
        this.bindEvents();
    },
    
    bindEvents() {
        const bind = (id, event, key) => {
            const el = document.getElementById(id);
            if(el) el.addEventListener(event, e => this.handleUpdate(key, e.target.value));
        };
        bind('font-size-range', 'input', 'fontSize');
        bind('line-height-range', 'input', 'lineHeight');
        bind('margin-scroll-range', 'input', 'marginScroll');
        // bind('margin-vertical-range', 'input', 'marginVertical'); // Removed
        bind('global-zoom-range', 'input', 'globalZoom');
        bind('font-weight-range', 'input', 'fontWeight');
        bind('letter-spacing-range', 'input', 'letterSpacing');
        bind('font-color-picker', 'input', 'fontColor');
        bind('terminal-color-picker', 'input', 'terminalColor');
        bind('font-family-select', 'change', 'fontFamily');
        
        ['align-toggle-group', 'theme-toggle-group'].forEach(id => {
            document.getElementById(id)?.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const key = id.includes('align') ? 'textAlign' : 'theme';
                    this.handleUpdate(key, btn.dataset.val);
                });
            });
        });

        document.querySelectorAll('.color-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                const picker = document.getElementById('terminal-color-picker');
                if(picker) picker.value = color;
                this.handleUpdate('terminalColor', color);
            });
        });
    },

    get() {
        const defaults = {
            globalZoom: '1.0',
            fontSize: '100', lineHeight: '1.6', 
            marginScroll: '28', 
            // marginVertical: '60', // Removed default
            textAlign: 'left', fontFamily: "'Inter', sans-serif",
            fontWeight: '400', letterSpacing: '0', fontColor: 'var(--text)',
            theme: 'dark', terminalColor: '#00FF41'
        };
        try {
            const saved = JSON.parse(localStorage.getItem('epubly-settings'));
            return { ...defaults, ...saved };
        } catch {
            return defaults;
        }
    },

    save(settings) { localStorage.setItem('epubly-settings', JSON.stringify(settings)); },

    load() {
        const s = this.get();
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
        setVal('font-size-range', s.fontSize);
        setVal('line-height-range', s.lineHeight);
        setVal('margin-scroll-range', s.marginScroll);
        // setVal('margin-vertical-range', s.marginVertical); // Removed
        setVal('font-weight-range', s.fontWeight);
        setVal('letter-spacing-range', s.letterSpacing);
        setVal('font-color-picker', s.fontColor);
        setVal('terminal-color-picker', s.terminalColor);
        setVal('font-family-select', s.fontFamily);
        setVal('global-zoom-range', s.globalZoom);
        
        const updateToggle = (groupId, val) => {
            document.getElementById(groupId)?.querySelectorAll('.toggle-btn').forEach(b => { 
                b.classList.toggle('active', b.dataset.val === val); 
            });
        };
        updateToggle('align-toggle-group', s.textAlign);
        updateToggle('theme-toggle-group', s.theme);
        
        const terminalOpts = document.getElementById('terminal-options');
        if (terminalOpts) {
            terminalOpts.style.display = s.theme === 'terminal' ? 'block' : 'none';
        }

        // Apply visual settings immediately
        if (window.Epubly && window.Epubly.reader) {
            window.Epubly.reader.applySettings(s);
        }
    },

    handleUpdate(key, value) {
        const s = this.get();
        s[key] = value;
        if (key === 'theme') {
            s.fontColor = (value === 'light' || value === 'sepia') ? '#1C1C1E' : '#F2F2F7';
        }
        this.save(s);
        this.load(); 
    }
};
