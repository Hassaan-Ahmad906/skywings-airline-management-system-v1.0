(() => {
    const dialogs = new Map();
    let labelId = 0;
    const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const visible = element => element.isConnected && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0;
    const modalSelector = '.modal, .bp-modal-overlay, .mock-payment-overlay, .skywings-details-modal-overlay, [id$="Modal"]';
    function enhance() {
        document.querySelectorAll('[onclick]').forEach(element => {
            if (!['BUTTON','A','INPUT','SELECT','TEXTAREA','FORM'].includes(element.tagName) && /^(DIV|SPAN|H[1-6])$/.test(element.tagName)) {
                element.setAttribute('role', 'button'); element.tabIndex = 0;
                if (!element.dataset.keyboardEnabled) {
                    element.dataset.keyboardEnabled = 'true';
                    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); } });
                }
            }
        });
        document.querySelectorAll('label:not([for])').forEach(label => {
            const input = label.parentElement.querySelector('input, select, textarea');
            if (input) { if (!input.id) input.id = `field_${++labelId}`; label.htmlFor = input.id; }
        });
        const hamburger = document.querySelector('.hamburger');
        if (hamburger) hamburger.setAttribute('aria-expanded', String(hamburger.classList.contains('active')));
        for (const [dialog, previousFocus] of dialogs) {
            if (!visible(dialog)) {
                dialogs.delete(dialog);
                if (previousFocus?.isConnected && (!document.activeElement || document.activeElement === document.body || dialog.contains(document.activeElement))) previousFocus.focus();
            }
        }
        document.querySelectorAll(modalSelector).forEach(dialog => {
            if (!visible(dialog) || dialogs.has(dialog)) return;
            dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-label', dialog.querySelector('h2,h3')?.textContent || 'Dialog');
            dialog.tabIndex = -1;
            dialogs.set(dialog, document.activeElement);
            (Array.from(dialog.querySelectorAll(focusable)).find(visible) || dialog).focus();
        });
    }
    document.addEventListener('keydown', event => {
        const dialog = Array.from(dialogs.keys()).filter(visible).at(-1);
        if (!dialog) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            const close = dialog.querySelector('button.close, button.close-btn, button[class*="close"], button[aria-label^="Close"], #closeSkywingsModalBtn, .close[onclick]');
            if (close) close.click(); else dialog.style.display = 'none';
        } else if (event.key === 'Tab') {
            const elements = Array.from(dialog.querySelectorAll(focusable)).filter(visible);
            const first = elements[0], last = elements.at(-1);
            if (!first) { event.preventDefault(); dialog.focus(); }
            else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        enhance();
        new MutationObserver(enhance).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style','class'] });
    });
})();
