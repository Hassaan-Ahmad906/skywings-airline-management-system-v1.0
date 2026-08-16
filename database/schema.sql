-- SkyWings Airlines Master Database Schema
-- Complete Relational Schema for Enterprise Deployment

CREATE DATABASE IF NOT EXISTS skywings_airlines CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE skywings_airlines;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    date_of_birth DATE,
    address TEXT,
    role ENUM('user', 'admin') DEFAULT 'user',
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Aircraft Table
CREATE TABLE IF NOT EXISTS aircraft (
    aircraft_id INT AUTO_INCREMENT PRIMARY KEY,
    model VARCHAR(100) NOT NULL,
    registration VARCHAR(20) NOT NULL UNIQUE,
    capacity INT NOT NULL,
    status ENUM('active', 'maintenance', 'retired') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Airports Table
CREATE TABLE IF NOT EXISTS airports (
    airport_code VARCHAR(3) PRIMARY KEY,
    airport_name VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Flights Table
CREATE TABLE IF NOT EXISTS flights (
    flight_id INT AUTO_INCREMENT PRIMARY KEY,
    flight_number VARCHAR(20) NOT NULL UNIQUE,
    aircraft_id INT NOT NULL,
    from_airport_code VARCHAR(3) NOT NULL,
    to_airport_code VARCHAR(3) NOT NULL,
    departure_datetime DATETIME NOT NULL,
    arrival_datetime DATETIME NOT NULL,
    status ENUM('scheduled', 'delayed', 'cancelled', 'completed', 'boarding') DEFAULT 'scheduled',
    base_price DECIMAL(10, 2) NOT NULL,
    business_price DECIMAL(10, 2) NOT NULL,
    first_class_price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (aircraft_id) REFERENCES aircraft(aircraft_id) ON DELETE RESTRICT,
    FOREIGN KEY (from_airport_code) REFERENCES airports(airport_code) ON DELETE RESTRICT,
    FOREIGN KEY (to_airport_code) REFERENCES airports(airport_code) ON DELETE RESTRICT,
    INDEX idx_flight_number (flight_number),
    INDEX idx_departure (departure_datetime),
    INDEX idx_status (status),
    INDEX idx_route (from_airport_code, to_airport_code),
    CHECK (arrival_datetime > departure_datetime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Bookings Table (With State Machine Lifecycle Columns)
CREATE TABLE IF NOT EXISTS bookings (
    booking_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_reference VARCHAR(20) NOT NULL UNIQUE,
    user_id INT NOT NULL,
    flight_id INT NOT NULL,
    booking_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    number_of_passengers INT NOT NULL,
    class ENUM('economy', 'business', 'first') NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_status ENUM('pending', 'paid', 'refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    idempotency_key VARCHAR(100) NULL UNIQUE,
    confirmed_at TIMESTAMP NULL,
    checked_in_at TIMESTAMP NULL,
    boarded_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    expired_at TIMESTAMP NULL,
    state_change_reason VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (flight_id) REFERENCES flights(flight_id) ON DELETE RESTRICT,
    INDEX idx_booking_ref (booking_reference),
    INDEX idx_user (user_id),
    INDEX idx_flight (flight_id),
    INDEX idx_status (status),
    INDEX idx_idempotency_key (idempotency_key),
    CHECK (number_of_passengers > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Passengers Table
CREATE TABLE IF NOT EXISTS passengers (
    passenger_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    passport_number VARCHAR(50),
    nationality VARCHAR(100),
    is_saved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Booking Passengers Table
CREATE TABLE IF NOT EXISTS booking_passengers (
    booking_passenger_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    passenger_id INT NOT NULL,
    seat_number VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (passenger_id) REFERENCES passengers(passenger_id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_passenger (passenger_id),
    INDEX idx_seat (seat_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Seats Table
CREATE TABLE IF NOT EXISTS seats (
    seat_id INT AUTO_INCREMENT PRIMARY KEY,
    aircraft_id INT NOT NULL,
    seat_number VARCHAR(10) NOT NULL,
    seat_class ENUM('economy', 'business', 'first') NOT NULL,
    `row_number` INT NOT NULL,
    column_letter VARCHAR(2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (aircraft_id) REFERENCES aircraft(aircraft_id) ON DELETE CASCADE,
    UNIQUE KEY unique_seat (aircraft_id, seat_number),
    INDEX idx_aircraft (aircraft_id),
    INDEX idx_available (is_available),
    INDEX idx_class (seat_class)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Check-ins Table
CREATE TABLE IF NOT EXISTS check_ins (
    check_in_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL UNIQUE,
    check_in_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gate_number VARCHAR(10),
    boarding_time DATETIME,
    status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
    preference_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    preferred_seat ENUM('window', 'aisle', 'middle', 'none') DEFAULT 'none',
    meal_preference ENUM('vegetarian', 'non-vegetarian', 'vegan', 'halal', 'none') DEFAULT 'none',
    newsletter_subscription BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Tickets Table (13-Digit IATA Electronic Tickets)
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_number VARCHAR(20) NOT NULL UNIQUE,
    booking_id INT NOT NULL,
    passenger_id INT NOT NULL,
    flight_id INT NOT NULL,
    seat_number VARCHAR(10) NULL,
    cabin_class VARCHAR(20) NOT NULL DEFAULT 'ECONOMY',
    status ENUM('ISSUED', 'USED', 'EXCHANGED', 'REFUNDED', 'VOID', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_timestamp TIMESTAMP NULL,
    void_timestamp TIMESTAMP NULL,
    cancelled_timestamp TIMESTAMP NULL,
    exchanged_timestamp TIMESTAMP NULL,
    refunded_timestamp TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    barcode_data VARCHAR(255) NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (passenger_id) REFERENCES passengers(passenger_id) ON DELETE RESTRICT,
    FOREIGN KEY (flight_id) REFERENCES flights(flight_id) ON DELETE RESTRICT,
    INDEX idx_ticket_number (ticket_number),
    INDEX idx_ticket_booking (booking_id),
    INDEX idx_ticket_passenger (passenger_id),
    INDEX idx_ticket_flight (flight_id),
    INDEX idx_ticket_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Ticket Audit Logs Table
CREATE TABLE IF NOT EXISTS ticket_audit_logs (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    old_status VARCHAR(20) NULL,
    new_status VARCHAR(20) NOT NULL,
    changed_by_user_id INT NULL,
    reason VARCHAR(255) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE CASCADE,
    INDEX idx_audit_ticket (ticket_id),
    INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Seat Holds Table (Temporary Locking with TTL)
CREATE TABLE IF NOT EXISTS seat_holds (
    hold_id INT AUTO_INCREMENT PRIMARY KEY,
    flight_id INT NOT NULL,
    seat_number VARCHAR(10) NOT NULL,
    user_id INT NULL,
    session_id VARCHAR(100) NOT NULL,
    passenger_index INT DEFAULT 0,
    status ENUM('HELD', 'CONFIRMED', 'EXPIRED', 'RELEASED') NOT NULL DEFAULT 'HELD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (flight_id) REFERENCES flights(flight_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    INDEX idx_holds_active (flight_id, seat_number, status, expires_at),
    INDEX idx_holds_session (session_id, user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Flight Seat Allocations Table (Transactional Concurrency Guard)
CREATE TABLE IF NOT EXISTS flight_seat_allocations (
    allocation_id INT AUTO_INCREMENT PRIMARY KEY,
    flight_id INT NOT NULL,
    seat_number VARCHAR(10) NOT NULL,
    booking_id INT NULL,
    user_id INT NULL,
    status ENUM('held', 'confirmed') NOT NULL DEFAULT 'confirmed',
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (flight_id) REFERENCES flights(flight_id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    UNIQUE KEY uq_flight_seat (flight_id, seat_number),
    INDEX idx_alloc_flight_status (flight_id, status),
    INDEX idx_alloc_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Booking Rebooking History Table
CREATE TABLE IF NOT EXISTS booking_rebooking_history (
    rebook_id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    previous_flight_id INT NOT NULL,
    new_flight_id INT NOT NULL,
    fare_difference DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    rebooked_by INT NULL,
    rebook_reason VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (previous_flight_id) REFERENCES flights(flight_id) ON DELETE RESTRICT,
    FOREIGN KEY (new_flight_id) REFERENCES flights(flight_id) ON DELETE RESTRICT,
    FOREIGN KEY (rebooked_by) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_rebook_booking (booking_id),
    INDEX idx_rebook_flights (previous_flight_id, new_flight_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. Flight Disruptions & Affected Passengers Tables
CREATE TABLE IF NOT EXISTS flight_disruptions (
    disruption_id INT AUTO_INCREMENT PRIMARY KEY,
    flight_id INT NOT NULL,
    disruption_type ENUM('DELAY', 'CANCELLATION', 'DIVERSION', 'AIRCRAFT_CHANGE', 'GATE_CHANGE', 'SCHEDULE_CHANGE') NOT NULL,
    reason VARCHAR(255) NOT NULL,
    scheduled_departure_original DATETIME NOT NULL,
    scheduled_arrival_original DATETIME NOT NULL,
    new_departure DATETIME NULL,
    new_arrival DATETIME NULL,
    affected_passengers_count INT NOT NULL DEFAULT 0,
    status ENUM('PENDING', 'NOTIFIED', 'RESOLVED') NOT NULL DEFAULT 'PENDING',
    execution_key VARCHAR(100) NULL UNIQUE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (flight_id) REFERENCES flights(flight_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_disruption_flight (flight_id),
    INDEX idx_disruption_type (disruption_type),
    INDEX idx_disruption_status (status),
    INDEX idx_execution_key (execution_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS disruption_affected_passengers (
    affected_id INT AUTO_INCREMENT PRIMARY KEY,
    disruption_id INT NOT NULL,
    booking_id INT NOT NULL,
    passenger_id INT NOT NULL,
    ticket_id INT NULL,
    action_taken ENUM('NONE', 'AUTO_REBOOKED', 'MANUAL_REBOOKED', 'REFUNDED', 'NOTIFIED') NOT NULL DEFAULT 'NONE',
    notification_status ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (disruption_id) REFERENCES flight_disruptions(disruption_id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (passenger_id) REFERENCES passengers(passenger_id) ON DELETE RESTRICT,
    FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE SET NULL,
    INDEX idx_affected_disruption (disruption_id),
    INDEX idx_affected_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. Centralized Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NULL,
    old_value JSON NULL,
    new_value JSON NULL,
    metadata JSON NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    request_id VARCHAR(100) NULL,
    status ENUM('SUCCESS', 'FAILURE') NOT NULL DEFAULT 'SUCCESS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_audit_user (user_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_resource (resource_type, resource_id),
    INDEX idx_audit_created (created_at),
    INDEX idx_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
