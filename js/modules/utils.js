
/**
 * Utilities & Debugging
 */
export const Debug = {
    init() {
        window.onerror = (msg, url, line) => {
            console.error(`Epubly Error: ${msg} (${url}:${line})`);
        };
    }
};

export const Utils = {
    resolvePath(base, relative) {
        if (!base || !relative) return relative;
        const stack = base.split("/");
        stack.pop();
        relative.split("/").forEach(part => {
            if (part === ".") return;
            if (part === "..") stack.pop();
            else stack.push(part);
        });
        return stack.join("/");
    }
};
