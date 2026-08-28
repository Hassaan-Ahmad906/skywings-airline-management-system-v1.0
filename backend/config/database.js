I want you to integrate my existing airline management project with my n8n email automation system.

IMPORTANT: You are working with my EXISTING PROJECT. Do not assume that my project uses the sample field names below.

First inspect the complete project/codebase and understand how bookings, passengers, flights, payments, customers, seats, baggage, and check-in information are currently stored and processed.

Then implement the integration using the project's EXISTING architecture and data structures.

## PRODUCTION N8N WEBHOOK

This is the PRODUCTION webhook. Use this URL for the actual integration:

https://hassaanahmad2.app.n8n.cloud/webhook/c1c5404e-9aa6-4f33-b58e-8de402b5403c

DO NOT use the `/webhook-test/` URL.

This production webhook should be called from the airline project's backend when a customer's payment has been successfully confirmed.

## MAIN REQUIREMENT

When a customer successfully completes payment for a flight booking:

1. Detect the existing successful payment confirmation in my project.
2. Identify the booking associated with that payment.
3. Retrieve the customer's actual information.
4. Retrieve the actual passenger information.
5. Retrieve the actual flight information.
6. Retrieve the actual booking information.
7. Retrieve seat information if it exists.
8. Retrieve baggage information if it exists.
9. Retrieve payment information that is safe and relevant to a confirmation email.
10. Retrieve check-in information if it exists.
11. Build a JSON payload from the ACTUAL project data.
12. Send the payload to the production n8n webhook using HTTP POST.
13. Set Content-Type to application/json.
14. Do not hard-code any customer, booking, flight, payment, or passenger values.

## IMPORTANT: THE PROJECT IS THE SOURCE OF TRUTH

The following is ONLY an example of the type of information the email system can use:

Booking Details

* Booking Reference
* Booking Status
* Passenger Name
* Number of Passengers

Flight Information

* Airline
* Flight Number
* Travel Class
* Departure Airport
* Departure Date
* Departure Time
* Arrival Airport
* Arrival Date
* Arrival Time
* Flight Duration

Baggage

* Allowance

Payment Information

* Payment Status
* Amount Paid
* Currency
* Payment Method

Check-in

* Check-in information

Additional Information

* Any other relevant information already available in the project

DO NOT assume these fields exist with these exact names.

For example, if my project uses:

bookingId instead of booking_reference

or:

flightNumber instead of flight.flight_number

or:

user.email instead of customer.email

then use the ACTUAL project field and map it to the webhook payload.

## TARGET WEBHOOK PAYLOAD

Use this as the logical target structure:

{
"event_type": "payment_confirmed",

"payment_status": "confirmed",

"customer": {
"name": "actual customer name",
"email": "actual customer email"
},

"passenger": {
"name": "actual passenger name"
},

"booking": {
"booking_reference": "actual booking reference",
"booking_status": "actual booking status",
"number_of_passengers": "actual number of passengers"
},

"flight": {
"airline": "actual airline",
"flight_number": "actual flight number",
"class": "actual travel class",
"duration": "actual flight duration",

```
"departure": {
  "airport": "actual departure airport",
  "date": "actual departure date",
  "time": "actual departure time"
},

"arrival": {
  "airport": "actual arrival airport",
  "date": "actual arrival date",
  "time": "actual arrival time"
}
```

},

"seat": {
"number": "actual seat number if available"
},

"baggage": {
"allowance": "actual baggage allowance if available"
},

"payment": {
"status": "actual payment status",
"amount": "actual paid amount",
"currency": "actual currency",
"method": "actual payment method"
},

"check_in": {
"information": "actual check-in information if available"
}
}

IMPORTANT:

This is a TARGET STRUCTURE, not a requirement that these fields already exist in my project.

Map the actual project data into this structure.

If information does not exist in the project, DO NOT invent it.

If a field is unavailable, omit it or use the closest existing project information only when appropriate.

## PAYMENT TRIGGER

The n8n webhook must ONLY be called after the existing payment process confirms that the payment was successful.

Correct flow:

Customer selects flight
↓
Booking created
↓
Payment initiated
↓
Payment succeeds
↓
Existing project confirms payment
↓
Get booking/customer/flight/payment data
↓
Create webhook JSON
↓
POST to production n8n webhook
↓
n8n creates confirmation email
↓
Gmail sends confirmation email

DO NOT trigger the webhook when:

* payment is pending
* payment fails
* payment is cancelled
* payment is abandoned
* booking is created but payment is not confirmed

## DO NOT SEND SENSITIVE PAYMENT DATA

Never send:

* Card number
* CVV
* Card PIN
* Password
* Payment gateway secret
* API keys
* Authentication tokens
* Any other sensitive credentials

Only send safe payment information required for the confirmation email, such as:

* payment status
* amount
* currency
* payment method

## DO NOT BREAK EXISTING PROJECT

Use the project's existing:

* backend
* API structure
* database models
* services
* controllers
* payment handling
* authentication
* error handling
* environment configuration

Do not rewrite unrelated code.

Do not create duplicate payment logic.

Do not hard-code booking information.

Do not hard-code the webhook URL in multiple places if the project already uses environment variables/configuration.

Prefer putting the production webhook URL in the project's environment/configuration system if appropriate.

## BEFORE MODIFYING CODE

First inspect the project and identify:

1. The backend technology.
2. Where successful payment confirmation is handled.
3. Where bookings are stored.
4. Where passenger information is stored.
5. Where flight information is stored.
6. Where customer information/email is stored.
7. Where seat information is stored.
8. Where baggage information is stored.
9. Where payment information is stored.
10. The best existing location to trigger the webhook.
11. How HTTP requests are currently made in the project.
12. Whether environment variables are already used for external URLs.

Then explain the exact mapping between the project's existing fields and the n8n payload.

For example:

project.user.email → customer.email
project.booking.reference → booking.booking_reference
project.flight.number → flight.flight_number

Use the ACTUAL names discovered in my project.

## IMPLEMENTATION

After inspecting the project:

1. Implement the n8n integration.
2. Trigger it only after successful payment.
3. Send the actual booking data.
4. POST it to:

https://hassaanahmad2.app.n8n.cloud/webhook/c1c5404e-9aa6-4f33-b58e-8de402b5403c

5. Handle webhook request failures appropriately without breaking the successful booking/payment process.
6. Follow the existing project's coding style.
7. Keep the implementation clean and production-ready.

## TESTING

After implementation, provide a test procedure using an actual test booking/payment flow in the project.

Verify that the webhook receives real dynamic data.

Do NOT use:

* Hassaan Ahmad
* SW123456
* SW301
* 25000 PKR
* 12A

unless those values actually exist in the project during testing.

These values are only examples.

Finally show me:

1. Files changed.
2. Exact integration point.
3. Actual project-to-webhook field mapping.
4. Final JSON payload structure.
5. How successful payment triggers the webhook.
6. How failures are handled.
7. How to test the complete flow.
