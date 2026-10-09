let journeyType = 'oneway', journeySearch = null, journeyChoices = [], journeyAirports = [], journeySearchVersion = 0;
function localJourneyDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function journeyDateOffsets(value) {
    const start = new Date(value + 'T00:00:00'), end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { utc_offset_minutes:start.getTimezoneOffset(), end_utc_offset_minutes:end.getTimezoneOffset() };
}
document.addEventListener('DOMContentLoaded', async () => {
    if (!document.getElementById('flightSearchForm')) return;
    document.getElementById('searchDepDate').min = localJourneyDate();
    document.getElementById('searchDepDate').addEventListener('change', syncJourneyDates);
    try {
        const response = await apiRequest('/flights/airports'); journeyAirports = response.data.airports;
        for (const select of document.querySelectorAll('.journey-leg select')) {
            const value=select.value; select.innerHTML='<option value="">Select airport</option>'+journeyAirports.map(a=>html`<option value="${a.airport_code}">${a.city} (${a.airport_code})</option>`).join(''); select.value=value;
        }
    }
    catch (error) { document.getElementById('journeySearchStatus').textContent = error.message; }
});
function syncJourneyDates() {
    const departure = document.getElementById('searchDepDate').value;
    const returnInput = document.getElementById('searchReturnDate');
    returnInput.min = departure || localJourneyDate();
    if (returnInput.value && returnInput.value < returnInput.min) returnInput.value = '';
    let previous = departure || localJourneyDate();
    for (const input of document.querySelectorAll('.journey-leg [data-leg-field="departure"]')) { input.min = previous; if (input.value) previous = input.value; }
}
function setJourneyType(type) {
    journeyType = type; journeySearchVersion++; journeySearch = null; journeyChoices = [];
    document.querySelectorAll('[data-trip-type]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.tripType===type)));
    document.getElementById('journeyReturnGroup').hidden = type !== 'return';
    const input = document.getElementById('searchReturnDate'); input.disabled = type !== 'return'; input.required = type === 'return';
    const multi = document.getElementById('multiCityLegs'); multi.hidden = type !== 'multicity';
    document.getElementById('addJourneyLegButton').hidden = type !== 'multicity';
    if (type === 'multicity' && !multi.children.length) addJourneyLeg();
    multi.querySelectorAll('input,select').forEach(el => el.disabled = type !== 'multicity');
    document.getElementById('searchResults').style.display = 'none'; document.getElementById('journeySummary').hidden = true; syncJourneyDates();
}
function addJourneyLeg() {
    const multi = document.getElementById('multiCityLegs');
    if (multi.children.length >= 5) return;
    const previous = multi.lastElementChild?.querySelector('[data-leg-field="to"]').value || document.getElementById('searchToAirport').value;
    const row = document.createElement('section'); row.className = 'journey-leg';
    const options = '<option value="">Select airport</option>' + journeyAirports.map(a=>html`<option value="${a.airport_code}">${a.city} (${a.airport_code})</option>`).join('');
    row.innerHTML = html`<header><strong class="journey-leg-label"></strong><button type="button" class="ops-delete" onclick="removeJourneyLeg(this)">Remove leg</button></header><div class="journey-leg-grid"><label class="ops-field">From<select data-leg-field="from" required>${rawHtml(options)}</select></label><label class="ops-field">To<select data-leg-field="to" required>${rawHtml(options)}</select></label><label class="ops-field">Departure date<input type="date" data-leg-field="departure" required onchange="syncJourneyDates()"></label></div>`;
    row.querySelector('[data-leg-field="from"]').value = previous; multi.appendChild(row); updateJourneyLegLabels(); syncJourneyDates();
}
function updateJourneyLegLabels() {
    document.querySelectorAll('.journey-leg').forEach((row,i) => row.querySelector('.journey-leg-label').textContent = 'Flight leg ' + (i+2));
    document.getElementById('addJourneyLegButton').disabled = document.querySelectorAll('.journey-leg').length >= 5;
}
function removeJourneyLeg(button) { const multi = document.getElementById('multiCityLegs'); if (multi.children.length<=1) { alert('Multi-city journeys require at least two legs. Choose One-way for a single flight.'); return; } button.closest('.journey-leg').remove(); updateJourneyLegLabels(); syncJourneyDates(); }
async function handleJourneySearch(event) {
    const form = event.target, button = form.querySelector('button[type="submit"]');
    const legs = [{ from:form.elements.from.value, to:form.elements.to.value, departure:form.elements.departure.value }];
    if (journeyType === 'return') legs.push({ from:legs[0].to,to:legs[0].from,departure:document.getElementById('searchReturnDate').value });
    if (journeyType === 'multicity') document.querySelectorAll('.journey-leg').forEach(row=>legs.push(Object.fromEntries([...row.querySelectorAll('[data-leg-field]')].map(el=>[el.dataset.legField,el.value]))));
    legs.forEach(leg => Object.assign(leg, journeyDateOffsets(leg.departure)));
    const results = document.getElementById('searchResults'), notice = document.getElementById('journeySearchStatus');
    const version = ++journeySearchVersion;
    results.style.display = 'block'; document.getElementById('journeySummary').hidden = true; document.getElementById('flightsList').textContent = 'Finding available flights for each leg…'; button.disabled = true; notice.textContent = ''; journeyChoices = []; journeySearch = null;
    try {
        const params = new URLSearchParams({ legs:JSON.stringify(legs),trip_type:journeyType,class:form.elements.class.value,passengers:form.elements.passengers.value });
        const response = await apiRequest('/flights/itinerary-search?' + params);
        if (version !== journeySearchVersion) return;
        journeySearch = response.data; journeyChoices = Array(legs.length).fill(null); currentSearchResults = journeySearch.legs.flatMap(leg=>leg.flights); renderJourneyResults();
        results.scrollIntoView({ behavior:'smooth',block:'start' });
    } catch (error) { if (version===journeySearchVersion) { document.getElementById('flightsList').textContent = error.message; notice.dataset.tone='error'; } }
    finally { button.disabled = false; }
}
function renderJourneyResults() {
    if (!journeySearch) return;
    document.getElementById('searchResultsTitle').textContent = `${journeyType === 'return' ? 'Return journey' : journeyType === 'multicity' ? 'Multi-city journey' : 'One-way flights'} · ${journeySearch.passengers} passenger${journeySearch.passengers>1?'s':''}`;
    document.getElementById('searchResultsSubtitle').textContent = `Direct flights · ${journeySearch.class} · USD · Select each leg to review the total fare`;
    document.querySelectorAll('.sort-chip').forEach(b=>b.classList.toggle('active', b.getAttribute('onclick')?.includes(`'${currentSortCriterion}'`)));
    document.getElementById('flightsList').innerHTML = journeySearch.legs.map((leg,index)=> {
        const time=document.getElementById('journeyTimeFilter').value, fare=document.getElementById('journeyFareFilter').value;
        const sorted = leg.flights.filter(f=>{ const hour=new Date(f.departure_datetime).getHours(),range=time.split('-').map(Number); return (time==='all'||(hour>=range[0]&&hour<range[1]))&&(!fare||f.total_price<=Number(fare)); }).sort((a,b)=> currentSortCriterion==='duration' ? (new Date(a.arrival_datetime)-new Date(a.departure_datetime))-(new Date(b.arrival_datetime)-new Date(b.departure_datetime)) : currentSortCriterion==='departure' ? new Date(a.departure_datetime)-new Date(b.departure_datetime) : a.total_price-b.total_price);
        return html`<section class="journey-result-leg"><h3>${journeyType==='return' ? index===0?'Outbound':'Return' : `Flight ${index+1}`} · ${leg.from} → ${leg.to} · ${leg.departure}</h3>${rawHtml(sorted.map(f=>{
            const minutes = Math.round((new Date(f.arrival_datetime)-new Date(f.departure_datetime))/60000);
            return html`<article class="journey-result-card ${journeyChoices[index]?.flight_id===f.flight_id?'selected':''}"><div class="ops-actions"><div><h4>${f.flight_number} · ${f.from_city} → ${f.to_city}</h4><p>${new Date(f.departure_datetime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} – ${new Date(f.arrival_datetime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${Math.floor(minutes/60)}h ${minutes%60}m · Direct</p><span class="ops-badge">${f.available_seats} seats available · ${f.status}</span></div><div><p class="journey-total">$${Number(f.total_price).toFixed(2)} USD</p><small>Total for ${journeySearch.passengers} passenger(s)</small></div></div><div class="ops-actions"><button type="button" class="btn btn-primary btn-book-flight" aria-pressed="${journeyChoices[index]?.flight_id===f.flight_id}" onclick="chooseJourneyFlight(${index},${Number(f.flight_id)})">${journeyType==='oneway'?'Book flight':journeyChoices[index]?.flight_id===f.flight_id?'Selected':'Select flight'}</button><small>$${Number(f.price).toFixed(2)} per passenger · ${journeySearch.class}</small></div></article>`;
        }).join('') || '<p class="ops-empty">No available flights for this route and date. Change this leg and search again.</p>')}</section>`;
    }).join(''); updateJourneySummary();
}
function chooseJourneyFlight(index,id) {
    const flight = journeySearch.legs[index].flights.find(f=>Number(f.flight_id)===id); if (!flight) return;
    if (journeyType==='oneway') { bookFlight(id,flight.price,journeySearch.class,journeySearch.passengers); return; }
    journeyChoices[index] = flight; renderJourneyResults();
}
function updateJourneySummary() {
    const summary = document.getElementById('journeySummary');
    if (journeyType==='oneway') { summary.hidden=true; return; }
    summary.hidden=false; const selected = journeyChoices.filter(Boolean), total = selected.reduce((sum,f)=>sum+f.total_price,0);
    summary.innerHTML = html`<div class="ops-actions"><div><strong>${selected.length} of ${journeyChoices.length} flights selected</strong><p class="journey-selection">${rawHtml(selected.map(f=>html`<span class="ops-badge">${f.flight_number} ${f.from_code} → ${f.to_code}</span>`).join(''))}</p><span class="journey-total">$${total.toFixed(2)} USD total</span></div><button type="button" class="btn btn-primary" onclick="bookSelectedJourney()" ${rawHtml(selected.length===journeyChoices.length?'':'disabled')}>Continue with journey</button></div>`;
}
function bookSelectedJourney() {
    if (journeyChoices.some(f=>!f)) return;
    for (let i=1;i<journeyChoices.length;i++) { const prior=journeyChoices[i-1],next=journeyChoices[i],gap=new Date(next.departure_datetime)-new Date(prior.arrival_datetime); if (gap<(prior.to_code===next.from_code?60*60000:0)) { alert('Selected flights overlap or leave less than 60 minutes for a connection. Choose different flights.'); return; } }
    if (!checkAuthentication('user')) { sessionStorage.setItem('redirectAfterLogin','flight-search.html'); window.location.href='login.html'; return; }
    currentBookingFlight=journeyChoices[0]; currentBookingClass=journeySearch.class; currentBookingPassengers=journeySearch.passengers;
    const price=journeyChoices.reduce((sum,f)=>sum+f.price,0); showBookingModal(journeyChoices[0].flight_id,price,journeySearch.class,journeySearch.passengers);
    const form=document.getElementById('bookingForm'); form.dataset.journeyFlights=JSON.stringify(journeyChoices.map(f=>f.flight_id)); form.dataset.journeyType=journeyType;
    document.getElementById('bookingModalTitle').textContent='Complete your journey reservation';
    document.getElementById('passengerForms').firstElementChild.innerHTML = html`<h3>Journey summary</h3>${rawHtml(journeyChoices.map((f,i)=>html`<p>${i+1}. ${f.flight_number} · ${f.from_city} → ${f.to_city} · ${new Date(f.departure_datetime).toLocaleString()}</p>`).join(''))}<p><strong>${journeySearch.passengers} passenger(s) · ${journeySearch.class} · $${(price*journeySearch.passengers).toFixed(2)} USD total</strong></p><p>All flights reserve together for ten minutes. Check-in and seat selection are separate for each flight.</p>`;
}
