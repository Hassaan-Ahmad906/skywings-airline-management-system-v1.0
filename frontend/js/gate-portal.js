let gateFlights = [], gateManifest = [], gateSelectedFlight = null, gateBusy = false, gateLoadVersion = 0;
document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('gateOperations')) return;
    try {
        const { data } = await apiRequest('/auth/check');
        if (!['crew','admin'].includes(data.user?.role)) return;
        if (data.user.role === 'admin' && document.getElementById('crewAccountPanel')) {
            document.getElementById('crewAccountPanel').hidden = false; document.getElementById('crewAdminLink').hidden = false;
            const airports = await apiRequest('/flights/airports');
            document.getElementById('crewAccountAirport').innerHTML = airports.data.airports.map(a => html`<option value="${a.airport_code}">${a.city} (${a.airport_code})</option>`).join('');
        }
        document.getElementById('gateOperations').innerHTML = `<div class="crew-layout"><aside><label class="ops-field">Find flight<input id="gateFlightSearch" type="search" placeholder="Flight number or route" oninput="renderGateFlights()"></label><div class="crew-flight-list" id="gateFlightList"></div></aside><div><div id="gateFlightDetails" class="ops-empty">Select a flight from the departure list.</div><div id="gateWorkspace" hidden>
            <div class="ops-toolbar"><label>Departure gate<input id="gateNumber" maxlength="10" placeholder="e.g. A12"></label><button type="button" class="btn btn-secondary" onclick="setGateOperation('assign')">Assign gate</button><button type="button" class="btn btn-primary" onclick="setGateOperation('open')">Open boarding</button><button type="button" class="ops-delete" onclick="setGateOperation('close')">Close boarding</button></div>
            <p id="gateOperationResult" class="ops-notice" role="status"></p><div class="ops-metrics"><div class="ops-metric">Expected<strong id="gateExpected">0</strong></div><div class="ops-metric">Boarded<strong id="gateBoarded">0</strong></div><div class="ops-metric">Awaiting boarding<strong id="gateRemaining">0</strong></div></div>
            <form class="crew-scan" id="crewScanForm" onsubmit="scanGatePassenger(event)"><div><label class="ops-field">Scan or enter boarding code<input name="boarding_token" autocomplete="off" minlength="64" maxlength="64" required placeholder="Scan with a connected barcode reader"></label><label class="identity-check"><input type="checkbox" name="identity_verified" required> Passenger identity verified</label></div><button type="submit" class="btn btn-primary">Record boarding</button></form>
            <div class="crew-search"><label class="ops-field">Search manifest<input type="search" id="gatePassengerSearch" placeholder="Passenger name, seat or booking" oninput="renderGateManifest()"></label></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Passenger</th><th>Seat</th><th>Booking</th><th>Status</th></tr></thead><tbody id="gateManifestRows"></tbody></table></div>
            <details><summary>Gate audit · latest 100 events</summary><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Result</th><th>Details</th></tr></thead><tbody id="gateAuditRows"></tbody></table></div></details></div></div></div>`;
        await loadGateFlights();
    } catch (error) { document.getElementById('gateOperations').textContent = error.message; }
});
async function loadGateFlights(refreshSelected = true) {
    try { const { data } = await apiRequest('/boarding/flights'); gateFlights = data.flights; const scope = document.getElementById('crewScope'); if (scope) scope.textContent = `${data.airport} · Departures in the next 72 hours and recent flights`; renderGateFlights(); if(refreshSelected&&gateSelectedFlight&&!gateBusy) await selectGateFlight(gateSelectedFlight); }
    catch (error) { document.getElementById('gateFlightList').textContent = error.message; }
}
function renderGateFlights() {
    const q = (document.getElementById('gateFlightSearch').value || '').toLowerCase();
    document.getElementById('gateFlightList').innerHTML = gateFlights.filter(f => `${f.flight_number} ${f.from_airport_code} ${f.to_airport_code}`.toLowerCase().includes(q)).map(f => html`<button type="button" class="crew-flight" aria-pressed="${Number(f.flight_id) === gateSelectedFlight}" onclick="selectGateFlight(${Number(f.flight_id)})"><strong>${f.flight_number} · ${f.from_airport_code} → ${f.to_airport_code}</strong><small>${new Date(f.departure_datetime).toLocaleString()} · ${f.gate_number || 'Gate TBA'}</small><small>${f.boarded}/${f.expected} boarded · ${f.status}</small></button>`).join('') || '<p class="ops-empty">No flights match this airport and time window.</p>';
}
async function selectGateFlight(id) {
    if (gateBusy) return;
    const version = ++gateLoadVersion; gateSelectedFlight = id; renderGateFlights();
    try {
        const [manifest,audit] = await Promise.all([apiRequest(`/boarding/flights/${id}/manifest`), apiRequest(`/boarding/flights/${id}/audit`)]);
        if (version !== gateLoadVersion) return;
        const f = manifest.data.flight; gateManifest = manifest.data.passengers;
        document.getElementById('gateWorkspace').hidden = false;
        document.getElementById('gateFlightDetails').classList.remove('ops-empty');
        const minutes=(new Date(f.departure_datetime)-Date.now())/60000, operational=!['cancelled','completed','in_air'].includes(f.status), windowOpen=operational&&minutes>0&&minutes<=90;
        document.getElementById('gateFlightDetails').innerHTML = html`<h3>${f.flight_number} · ${f.from_airport_code} → ${f.to_airport_code}</h3><p>${new Date(f.departure_datetime).toLocaleString()} · <strong>${f.boarding_open&&windowOpen ? 'Boarding open' : 'Boarding closed'}</strong></p><small>${minutes<=0?'Departure time has passed.':minutes>90?'Boarding opens 90 minutes before departure.':'Verify passenger identity before each scan.'}</small>`;
        document.querySelector('button[onclick="setGateOperation(\'open\')"]').disabled=!windowOpen||!!f.boarding_open;
        document.querySelector('button[onclick="setGateOperation(\'close\')"]').disabled=!f.boarding_open;
        document.querySelector('button[onclick="setGateOperation(\'assign\')"]').disabled=!operational||minutes<=0;
        document.getElementById('gateNumber').value = f.gate_number || '';
        const active = gateManifest.filter(p => ['CONFIRMED','CHECKED_IN','BOARDED'].includes(p.status));
        const boarded = active.filter(p => p.boarded_at).length;
        document.getElementById('gateExpected').textContent = active.length; document.getElementById('gateBoarded').textContent = boarded; document.getElementById('gateRemaining').textContent = active.length - boarded;
        document.querySelector('#crewScanForm button').disabled = !f.boarding_open||!windowOpen;
        renderGateManifest();
        document.getElementById('gateAuditRows').innerHTML = audit.data.events.map(e => html`<tr><td>${new Date(e.created_at).toLocaleTimeString()}</td><td>${e.actor_name || 'System'}</td><td>${e.action.replaceAll('_',' ')}</td><td>${e.outcome}</td><td>${e.reason}</td></tr>`).join('') || '<tr><td colspan="5">No gate events yet.</td></tr>';
    } catch (error) { document.getElementById('gateWorkspace').hidden = true; document.getElementById('gateFlightDetails').textContent = error.message; }
}
function renderGateManifest() {
    const q = document.getElementById('gatePassengerSearch').value.toLowerCase();
    document.getElementById('gateManifestRows').innerHTML = gateManifest.filter(p => `${p.first_name} ${p.last_name} ${p.seat_number} ${p.booking_reference}`.toLowerCase().includes(q)).map(p => html`<tr><td>${p.first_name} ${p.last_name}</td><td>${p.seat_number || 'Unassigned'}</td><td>${p.booking_reference}</td><td><span class="ops-badge ${p.boarded_at ? 'resolved' : ''}">${p.boarded_at ? 'Boarded' : p.status === 'CHECKED_IN' ? 'Ready to board' : p.status.replaceAll('_',' ')}</span></td></tr>`).join('') || '<tr><td colspan="4">No passengers match this search.</td></tr>';
}
async function gateAction(task, success) {
    if (gateBusy || !gateSelectedFlight) return;
    gateBusy = true;
    const notice = document.getElementById('gateOperationResult'), buttons = document.querySelectorAll('#gateWorkspace button'); buttons.forEach(b => b.disabled = true);
    try { await task(); notice.textContent = success; notice.dataset.tone = 'success'; }
    catch (error) { notice.textContent = error.message; notice.dataset.tone = 'error'; }
    finally { gateBusy = false; buttons.forEach(b => b.disabled = false); await loadGateFlights(false); await selectGateFlight(gateSelectedFlight); }
}
async function setGateOperation(action) {
    if (action === 'close' && !confirm('Close boarding for this flight? Further scans will be rejected.')) return;
    await gateAction(() => apiRequest(`/boarding/flights/${gateSelectedFlight}/gate`, { method:'PATCH', body:JSON.stringify({ action, gate_number: document.getElementById('gateNumber').value.trim().toUpperCase() }) }), 'Gate updated.');
}
async function scanGatePassenger(event) {
    event.preventDefault(); const form = event.target;
    const data = new FormData(form);
    await gateAction(async () => { await apiRequest('/boarding/scan', { method:'POST', body:JSON.stringify({ flight_id:gateSelectedFlight, boarding_token:data.get('boarding_token').trim(), identity_verified:data.get('identity_verified') === 'on' }) }); form.reset(); }, 'Passenger boarding recorded.');
    form.elements.boarding_token.focus();
}
async function createGateStaff(event) {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'), result = document.getElementById('crewAccountResult'); button.disabled = true;
    try { await apiRequest('/boarding/staff', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); result.textContent = 'Airport crew account created.'; }
    catch (error) { result.textContent = error.message; } finally { button.disabled = false; }
}
