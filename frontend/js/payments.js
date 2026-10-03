let activeMockPaymentState = null;

function closeMockPaymentModal() {
    document.getElementById('mockPaymentOverlay')?.remove();
}

async function openMockPaymentModal(booking) {
    try {
        const options = await apiRequest('/bookings/payment-options');
        if (!options.data.demo_enabled) {
            alert('Online payments are unavailable. Your reservation remains unpaid in My Bookings.');
            return;
        }
        closeMockPaymentModal();
        activeMockPaymentState = { paymentTarget: booking.payment_target || `/bookings/${booking.booking_id}/pay` };
        const overlay = document.createElement('div');
        overlay.id = 'mockPaymentOverlay';
        overlay.className = 'mock-payment-overlay';
        overlay.innerHTML = `<div class="mock-payment-card">
            <div class="mock-payment-header"><h3 id="demoPaymentTitle">Demo booking confirmation</h3>
            <button type="button" aria-label="Close confirmation" onclick="closeMockPaymentModal()">&times;</button></div>
            <p>This is a demonstration. No money will be collected. Do not enter payment details.</p>
            <p id="demoBookingReference"></p><p id="demoBookingAmount"></p>
            <form onsubmit="executeMockPayment(event)"><div class="mock-payment-actions">
                <button type="submit" class="btn-pay-now" id="btnExecuteMockPayment">Confirm demo booking</button>
                <button type="button" class="btn-pay-later" onclick="closeMockPaymentModal()">Keep unpaid reservation</button>
            </div></form></div>`;
        overlay.querySelector('#demoBookingReference').textContent = `Booking: ${booking.booking_reference}`;
        overlay.querySelector('#demoBookingAmount').textContent = `Sample fare: $${Number(booking.total_amount).toFixed(2)} USD`;
        document.body.appendChild(overlay);
    } catch (error) {
        alert(error.message);
    }
}

async function executeMockPayment(event) {
    event.preventDefault();
    const button = document.getElementById('btnExecuteMockPayment');
    if (!activeMockPaymentState || button.disabled) return;
    button.disabled = true;
    try {
        await apiRequest(activeMockPaymentState.paymentTarget, { method: 'POST', body: '{}' });
        closeMockPaymentModal();
        alert('Demo booking confirmed. No money was collected.');
        window.location.href = 'my-bookings.html';
    } catch (error) {
        button.disabled = false;
        alert(error.message);
    }
}
