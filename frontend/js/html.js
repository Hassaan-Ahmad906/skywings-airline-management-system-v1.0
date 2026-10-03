// Escape untrusted values at HTML rendering boundaries. Text/property writes
// should use textContent/value directly instead of applying this function.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function rawHtml(value) {
    return { trustedHtml: true, value: String(value ?? '') };
}

function html(strings, ...values) {
    return strings.reduce((result, literal, index) => result + literal + (index < values.length
        ? (values[index]?.trustedHtml === true ? values[index].value : escapeHtml(values[index])) : ''), '');
}
