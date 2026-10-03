let inboxPage = 1, inboxRequest = 0;
async function loadContactMessages(page = 1) {
    const list = document.getElementById('adminContactMessages');
    if (!list) return;
    const request = ++inboxRequest;
    inboxPage = page;
    const notice = document.getElementById('inboxResult');
    notice.textContent = 'Loading messages…'; notice.dataset.tone = '';
    try {
        const params = new URLSearchParams({ page, q: document.getElementById('inboxQuery').value, status: document.getElementById('inboxStatus').value });
        const { data } = await apiRequest('/contact?' + params);
        if (request !== inboxRequest) return;
        if (!data.messages.length && page > 1) return loadContactMessages(page - 1);
        list.innerHTML = data.messages.map(m => html`<article class="inbox-card" data-message-id="${Number(m.message_id)}">
            <header><h3>${m.name}</h3><span class="ops-badge ${m.deleted_at ? 'trash' : m.status}">${m.deleted_at ? 'Trash' : m.status}</span></header>
            <p><a href="mailto:${m.email}">${m.email}</a></p><small>${m.category.replaceAll('_',' ')} · #${m.message_id} · ${new Date(m.created_at).toLocaleString()}</small>
            <p class="message-body">${m.message}</p><footer>${rawHtml(m.deleted_at
                ? html`<button type="button" class="btn btn-secondary" onclick="changeSupportMessage(${Number(m.message_id)},'restore',this)">Restore</button>`
                : html`<button type="button" class="btn btn-secondary" onclick="changeSupportMessage(${Number(m.message_id)},'reviewed',this)" ${rawHtml(m.status === 'reviewed' ? 'disabled' : '')}>Mark reviewed</button><button type="button" class="btn btn-secondary" onclick="changeSupportMessage(${Number(m.message_id)},'resolved',this)" ${rawHtml(m.status === 'resolved' ? 'disabled' : '')}>Resolve</button><button type="button" class="ops-delete" onclick="changeSupportMessage(${Number(m.message_id)},'delete',this)">Delete message</button>`)}
            </footer></article>`).join('') || '<p class="ops-empty">No messages match these filters.</p>';
        notice.textContent = `${data.total} message${data.total === 1 ? '' : 's'}`;
        document.getElementById('inboxPage').textContent = `Page ${page} of ${Math.max(1, data.pages)}`;
        const prev = document.getElementById('inboxPrevious'), next = document.getElementById('inboxNext');
        prev.disabled = page <= 1; next.disabled = page >= data.pages;
        prev.onclick = () => loadContactMessages(page - 1); next.onclick = () => loadContactMessages(page + 1);
    } catch (error) { if (request === inboxRequest) { notice.textContent = error.message; notice.dataset.tone = 'error'; } }
}
async function changeSupportMessage(id, action, button) {
    if (action === 'delete' && !confirm(`Move message #${id} to Trash? You can restore it later.`)) return;
    button.disabled = true;
    try {
        await apiRequest('/contact/' + id + (action === 'restore' ? '/restore' : ''), {
            method: action === 'delete' ? 'DELETE' : action === 'restore' ? 'POST' : 'PATCH',
            ...(action === 'restore' || action === 'delete' ? {} : { body: JSON.stringify({ status: action }) })
        });
        await loadContactMessages(inboxPage);
    } catch (error) { const notice = document.getElementById('inboxResult'); notice.textContent = error.message; notice.dataset.tone = 'error'; button.disabled = false; }
}
