let seatSelectionBusy = false;
let seatHoldTimerInterval = null;
const selectedSeatHolds = new Map();

function setSeatSelectionBusy(busy) {
    seatSelectionBusy = busy;
    for (const action of ['confirmSeats()', 'resetSeats()']) {
        const button = document.querySelector(`button[onclick="${action}"]`);
        if (button) button.disabled = busy;
    }
    document.getElementById('seatMap')?.setAttribute('aria-busy', String(busy));
}

function seatSessionId() {
    const key = `checkin_session_${currentBooking.booking_id}`;
    let session = sessionStorage.getItem(key);
    if (!session) { session = crypto.randomUUID(); sessionStorage.setItem(key, session); }
    return session;
}

async function initializeSeatMap() {
    const seatMap = document.getElementById('seatMap');
    if (!seatMap || !currentBooking) return;
    const alreadyBusy = seatSelectionBusy;
    setSeatSelectionBusy(true);
    clearInterval(seatHoldTimerInterval);
    selectedSeats = [];
    selectedSeatHolds.clear();
    try {
        const response = await apiRequest(`/flights/${currentBooking.flight_id}/seat-map`);
        const seats = response.data?.seats || [];
        if (!seats.length) throw new Error('No aircraft seat layout is available.');
        seatMap.replaceChildren();
        const rows = new Map();
        const session = seatSessionId();
        const preselected = (currentBooking.passengers || []).map(p => p.seat_number).filter(Boolean);
        for (const seat of seats) {
            const rowNumber = seat.seat_number.match(/^\d+/)?.[0] || 'Seats';
            if (!rows.has(rowNumber)) {
                const row = document.createElement('div');
                row.className = 'seat-row';
                row.setAttribute('aria-label', `Row ${rowNumber}`);
                rows.set(rowNumber, row); seatMap.appendChild(row);
            }
            const ownsAssignment = Number(seat.booking_id) === Number(currentBooking.booking_id);
            const ownsHold = seat.mine && seat.session_id === session;
            const allowedCabin = seat.seat_class === currentBooking.class;
            const selected = allowedCabin && (ownsHold || (ownsAssignment && preselected.includes(seat.seat_number)));
            const available = allowedCabin && (seat.status === 'AVAILABLE' || ownsAssignment || ownsHold);
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = seat.seat_number;
            button.dataset.seat = seat.seat_number;
            button.dataset.assigned = ownsAssignment ? 'true' : 'false';
            button.className = `seat ${selected ? 'selected' : available ? 'available' : seat.status === 'HELD' ? 'held' : 'occupied'}`;
            button.disabled = !available;
            button.setAttribute('aria-pressed', String(selected));
            button.setAttribute('aria-label', `Seat ${seat.seat_number}, ${seat.seat_class}, ${available ? selected ? 'selected' : 'available' : 'unavailable'}`);
            button.addEventListener('click', () => selectSeat(button));
            if (selected) {
                selectedSeats.push(seat.seat_number);
                if (ownsHold) selectedSeatHolds.set(seat.seat_number, { hold_id: seat.hold_id, expires_at: seat.expires_at, passenger_index: seat.passenger_index });
            }
            rows.get(rowNumber).appendChild(button);
        }
        selectedSeats.sort((a, b) => preselected.indexOf(a) - preselected.indexOf(b));
        document.querySelector('.seat-info')?.remove();
        const info = document.createElement('p'); info.className = 'seat-info';
        info.setAttribute('aria-live', 'polite'); seatMap.after(info);
        updateSeatCount();
        seatHoldTimerInterval = setInterval(() => {
            if (seatSelectionBusy) return;
            if ([...selectedSeatHolds.values()].some(h => new Date(h.expires_at) <= new Date())) initializeSeatMap();
            else updateSeatCount();
        }, 1000);
    } catch (error) {
        seatMap.textContent = error.message || 'Unable to load seats. Please retry.';
    } finally {
        if (!alreadyBusy) setSeatSelectionBusy(false);
    }
}

async function selectSeat(element) {
    if (element.disabled || seatSelectionBusy) return;
    const seat = element.dataset.seat;
    const selected = selectedSeats.includes(seat);
    if (!selected && selectedSeats.length >= maxSeatsAllowed) { alert(`Select exactly ${maxSeatsAllowed} seat(s). Deselect a seat first.`); return; }
    setSeatSelectionBusy(true);
    element.disabled = true;
    try {
        if (selected) {
            const hold = selectedSeatHolds.get(seat);
            if (hold) await apiRequest(`/seat-holds/${hold.hold_id}`, { method: 'DELETE' });
            selectedSeatHolds.delete(seat);
            selectedSeats = selectedSeats.filter(value => value !== seat);
        } else {
            if (element.dataset.assigned !== 'true') {
                const used = new Set([...selectedSeatHolds.values()].map(h => Number(h.passenger_index)));
                let index = 0; while (used.has(index)) index++;
                const response = await apiRequest('/seat-holds', { method: 'POST', body: JSON.stringify({
                    flight_id: currentBooking.flight_id, booking_id: currentBooking.booking_id, seat_number: seat, session_id: seatSessionId(), passenger_index: index
                }) });
                selectedSeatHolds.set(seat, response.data);
            }
            selectedSeats.push(seat);
        }
        element.classList.toggle('selected', !selected);
        element.classList.toggle('available', selected);
        element.setAttribute('aria-pressed', String(!selected));
        updateSeatCount();
    } catch (error) { alert(error.message); await initializeSeatMap(); }
    finally { element.disabled = false; setSeatSelectionBusy(false); }
}

function updateSeatCount() {
    const info = document.querySelector('.seat-info');
    if (!info) return;
    const deadlines = [...selectedSeatHolds.values()].map(h => new Date(h.expires_at).getTime());
    const seconds = deadlines.length ? Math.max(0, Math.floor((Math.min(...deadlines) - Date.now()) / 1000)) : null;
    info.textContent = `Selected ${selectedSeats.length} of ${maxSeatsAllowed} seats${seconds === null ? '' : ` · Server hold expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}`;
}
