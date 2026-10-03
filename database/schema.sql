-- Canonical application schema. Select the database before executing.
-- Apply versioned migrations through npm run db:setup.

CREATE TABLE IF NOT EXISTS `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `role` enum('user','admin','crew') COLLATE utf8mb4_unicode_ci DEFAULT 'user',
  `gate_airport_code` VARCHAR(3) NULL,
  `status` enum('active','inactive','suspended') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `token_version` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `aircraft` (
  `aircraft_id` int NOT NULL AUTO_INCREMENT,
  `model` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `registration` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int NOT NULL,
  `status` enum('active','maintenance','retired') COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`aircraft_id`),
  UNIQUE KEY `registration` (`registration`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `airports` (
  `airport_code` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `airport_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `country` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`airport_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flights` (
  `flight_id` int NOT NULL AUTO_INCREMENT,
  `flight_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `aircraft_id` int NOT NULL,
  `from_airport_code` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_airport_code` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `departure_datetime` datetime NOT NULL,
  `arrival_datetime` datetime NOT NULL,
  `status` enum('scheduled','delayed','cancelled','completed','boarding','in_air') COLLATE utf8mb4_unicode_ci DEFAULT 'scheduled',
  `gate_number` VARCHAR(10) NULL,
  `boarding_open` TINYINT NOT NULL DEFAULT 0,
  `base_price` decimal(10,2) NOT NULL,
  `business_price` decimal(10,2) NOT NULL,
  `first_class_price` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`flight_id`),
  UNIQUE KEY `flight_number` (`flight_number`),
  KEY `aircraft_id` (`aircraft_id`),
  KEY `to_airport_code` (`to_airport_code`),
  KEY `idx_flight_number` (`flight_number`),
  KEY `idx_departure` (`departure_datetime`),
  KEY `idx_status` (`status`),
  KEY `idx_route` (`from_airport_code`,`to_airport_code`),
  CONSTRAINT `flights_ibfk_1` FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft` (`aircraft_id`) ON DELETE RESTRICT,
  CONSTRAINT `flights_ibfk_2` FOREIGN KEY (`from_airport_code`) REFERENCES `airports` (`airport_code`) ON DELETE RESTRICT,
  CONSTRAINT `flights_ibfk_3` FOREIGN KEY (`to_airport_code`) REFERENCES `airports` (`airport_code`) ON DELETE RESTRICT,
  CONSTRAINT `flights_chk_1` CHECK ((`arrival_datetime` > `departure_datetime`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bookings` (
  `booking_id` int NOT NULL AUTO_INCREMENT,
  `booking_reference` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int NOT NULL,
  `flight_id` int NOT NULL,
  `booking_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `number_of_passengers` int NOT NULL,
  `class` enum('economy','business','first') COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `status` enum('PENDING','CONFIRMED','CHECKED_IN','BOARDED','COMPLETED','CANCELLED','EXPIRED','MISSED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `payment_status` enum('pending','paid','refunded') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `refund_status` enum('none','pending','completed','failed') NOT NULL DEFAULT 'none',
  `payment_method` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `idempotency_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirmed_at` datetime DEFAULT NULL,
  `checked_in_at` datetime DEFAULT NULL,
  `boarded_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `expired_at` datetime DEFAULT NULL,
  `state_change_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reservation_expires_at` datetime DEFAULT NULL,
  `itinerary_id` INT NULL,
  `segment_index` INT NULL,
  PRIMARY KEY (`booking_id`),
  UNIQUE KEY `booking_reference` (`booking_reference`),
  UNIQUE KEY `uq_user_idempotency` (`user_id`,`idempotency_key`),
  KEY `idx_booking_ref` (`booking_reference`),
  KEY `idx_user` (`user_id`),
  KEY `idx_flight` (`flight_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE RESTRICT,
  CONSTRAINT `bookings_chk_1` CHECK ((`number_of_passengers` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `passengers` (
  `passenger_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date_of_birth` date DEFAULT NULL,
  `passport_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nationality` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_saved` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`passenger_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `passengers_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_passengers` (
  `booking_passenger_id` int NOT NULL AUTO_INCREMENT,
  `boarding_token` varchar(64) DEFAULT NULL,
  `boarded_at` datetime DEFAULT NULL,
  UNIQUE KEY `uq_passenger_boarding_token` (`boarding_token`),
  `booking_id` int NOT NULL,
  `passenger_id` int NOT NULL,
  `seat_number` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`booking_passenger_id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_passenger` (`passenger_id`),
  KEY `idx_seat` (`seat_number`),
  CONSTRAINT `booking_passengers_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE,
  CONSTRAINT `booking_passengers_ibfk_2` FOREIGN KEY (`passenger_id`) REFERENCES `passengers` (`passenger_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seats` (
  `seat_id` int NOT NULL AUTO_INCREMENT,
  `aircraft_id` int NOT NULL,
  `seat_number` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `seat_class` enum('economy','business','first') COLLATE utf8mb4_unicode_ci NOT NULL,
  `row_number` int NOT NULL,
  `column_letter` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_available` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`seat_id`),
  UNIQUE KEY `unique_seat` (`aircraft_id`,`seat_number`),
  KEY `idx_aircraft` (`aircraft_id`),
  KEY `idx_available` (`is_available`),
  KEY `idx_class` (`seat_class`),
  CONSTRAINT `seats_ibfk_1` FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft` (`aircraft_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `check_ins` (
  `check_in_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `check_in_datetime` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `gate_number` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `boarding_time` datetime DEFAULT NULL,
  `status` enum('pending','completed','cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `boarding_token` varchar(100) DEFAULT NULL,
  UNIQUE KEY `uq_boarding_token` (`boarding_token`),
  PRIMARY KEY (`check_in_id`),
  UNIQUE KEY `booking_id` (`booking_id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `check_ins_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_preferences` (
  `preference_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `preferred_seat` enum('window','aisle','middle','none') COLLATE utf8mb4_unicode_ci DEFAULT 'none',
  `meal_preference` enum('vegetarian','non-vegetarian','vegan','halal','none') COLLATE utf8mb4_unicode_ci DEFAULT 'none',
  `newsletter_subscription` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`preference_id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `user_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tickets` (
  `ticket_id` int NOT NULL AUTO_INCREMENT,
  `ticket_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `booking_id` int NOT NULL,
  `passenger_id` int NOT NULL,
  `flight_id` int NOT NULL,
  `seat_number` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cabin_class` enum('economy','business','first') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('ISSUED','VOID','USED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ISSUED',
  `issue_timestamp` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `void_timestamp` datetime DEFAULT NULL,
  `used_timestamp` datetime DEFAULT NULL,
  `cancelled_timestamp` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ticket_id`),
  UNIQUE KEY `ticket_number` (`ticket_number`),
  UNIQUE KEY `uq_booking_passenger` (`booking_id`,`passenger_id`),
  KEY `idx_ticket_number` (`ticket_number`),
  KEY `idx_booking_id` (`booking_id`),
  KEY `idx_passenger_id` (`passenger_id`),
  KEY `idx_flight_id` (`flight_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `tickets_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE RESTRICT,
  CONSTRAINT `tickets_ibfk_2` FOREIGN KEY (`passenger_id`) REFERENCES `passengers` (`passenger_id`) ON DELETE RESTRICT,
  CONSTRAINT `tickets_ibfk_3` FOREIGN KEY (`flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ticket_audit_logs` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int NOT NULL,
  `old_status` enum('ISSUED','VOID','USED','CANCELLED') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_status` enum('ISSUED','VOID','USED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_by_user_id` int DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `idx_ticket_log` (`ticket_id`),
  KEY `idx_changed_by` (`changed_by_user_id`),
  CONSTRAINT `ticket_audit_logs_ibfk_1` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`ticket_id`) ON DELETE RESTRICT,
  CONSTRAINT `ticket_audit_logs_ibfk_2` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `seat_holds` (
  `hold_id` int NOT NULL AUTO_INCREMENT,
  `flight_id` int NOT NULL,
  `seat_number` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` int NOT NULL,
  `session_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `passenger_index` int NOT NULL DEFAULT '0',
  `booking_id` int DEFAULT NULL,
  `status` enum('HELD','RELEASED','EXPIRED','CONSUMED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'HELD',
  `held_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  `released_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active_flag` tinyint GENERATED ALWAYS AS (if((`status` = _utf8mb4'HELD'),1,NULL)) VIRTUAL,
  PRIMARY KEY (`hold_id`),
  UNIQUE KEY `uq_flight_seat_active` (`flight_id`,`seat_number`,`active_flag`),
  KEY `idx_flight_seat_status` (`flight_id`,`seat_number`,`status`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_session_passenger` (`session_id`,`passenger_index`),
  KEY `idx_expires_status` (`expires_at`,`status`),
  CONSTRAINT `seat_holds_ibfk_1` FOREIGN KEY (`flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE CASCADE,
  CONSTRAINT `seat_holds_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flight_seat_allocations` (
  `allocation_id` int NOT NULL AUTO_INCREMENT,
  `flight_id` int NOT NULL,
  `seat_number` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `booking_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `user_id` int DEFAULT NULL,
  `status` enum('held','confirmed') COLLATE utf8mb4_unicode_ci DEFAULT 'confirmed',
  `expires_at` datetime DEFAULT NULL,
  PRIMARY KEY (`allocation_id`),
  UNIQUE KEY `unique_flight_seat` (`flight_id`,`seat_number`),
  KEY `idx_flight` (`flight_id`),
  KEY `idx_booking` (`booking_id`),
  KEY `user_id` (`user_id`),
  KEY `idx_expires` (`expires_at`),
  CONSTRAINT `flight_seat_allocations_ibfk_1` FOREIGN KEY (`flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE CASCADE,
  CONSTRAINT `flight_seat_allocations_ibfk_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE,
  CONSTRAINT `flight_seat_allocations_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `booking_rebooking_history` (
  `rebooking_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `old_flight_id` int NOT NULL,
  `new_flight_id` int NOT NULL,
  `rebooking_reason` enum('FLIGHT_CANCELLED','FLIGHT_DELAYED','SCHEDULE_CHANGE','CUSTOMER_REQUEST','AIRCRAFT_CHANGE','OPERATIONAL_OVERRIDE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_user_id` int DEFAULT NULL,
  `actor_type` enum('USER','CUSTOMER_SERVICE','OPERATIONS','ADMIN','SYSTEM') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
  `rebooking_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_seats_json` json DEFAULT NULL,
  `new_seats_json` json DEFAULT NULL,
  `notes` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('PENDING','EXECUTING','COMPLETED','FAILED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `failure_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `executed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`rebooking_id`),
  UNIQUE KEY `rebooking_key` (`rebooking_key`),
  KEY `actor_user_id` (`actor_user_id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_old_flight` (`old_flight_id`),
  KEY `idx_new_flight` (`new_flight_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `booking_rebooking_history_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE RESTRICT,
  CONSTRAINT `booking_rebooking_history_ibfk_2` FOREIGN KEY (`old_flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE RESTRICT,
  CONSTRAINT `booking_rebooking_history_ibfk_3` FOREIGN KEY (`new_flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE RESTRICT,
  CONSTRAINT `booking_rebooking_history_ibfk_4` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flight_disruptions` (
  `disruption_id` int NOT NULL AUTO_INCREMENT,
  `flight_id` int NOT NULL,
  `disruption_type` enum('DELAY','CANCELLATION','DIVERSION','AIRCRAFT_CHANGE','GATE_CHANGE','SCHEDULE_CHANGE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `operational_notes` text COLLATE utf8mb4_unicode_ci,
  `execution_key` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_departure_datetime` datetime DEFAULT NULL,
  `new_departure_datetime` datetime DEFAULT NULL,
  `old_arrival_datetime` datetime DEFAULT NULL,
  `new_arrival_datetime` datetime DEFAULT NULL,
  `old_aircraft_id` int DEFAULT NULL,
  `new_aircraft_id` int DEFAULT NULL,
  `old_gate` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `new_gate` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `executed_by_user_id` int DEFAULT NULL,
  `status` enum('PENDING_EXECUTION','EXECUTING','EXECUTED','FAILED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING_EXECUTION',
  `failure_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `execution_started_at` datetime DEFAULT NULL,
  `executed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`disruption_id`),
  UNIQUE KEY `execution_key` (`execution_key`),
  KEY `created_by_user_id` (`created_by_user_id`),
  KEY `executed_by_user_id` (`executed_by_user_id`),
  KEY `idx_flight` (`flight_id`),
  KEY `idx_type` (`disruption_type`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_status` (`status`),
  CONSTRAINT `flight_disruptions_ibfk_1` FOREIGN KEY (`flight_id`) REFERENCES `flights` (`flight_id`) ON DELETE RESTRICT,
  CONSTRAINT `flight_disruptions_ibfk_2` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `flight_disruptions_ibfk_3` FOREIGN KEY (`executed_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `disruption_affected_passengers` (
  `affected_id` int NOT NULL AUTO_INCREMENT,
  `disruption_id` int NOT NULL,
  `booking_id` int NOT NULL,
  `passenger_id` int NOT NULL,
  `ticket_id` int DEFAULT NULL,
  `seat_number` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `check_in_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notification_status` enum('PENDING','SENT','FAILED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `notification_attempts` int NOT NULL DEFAULT '0',
  `notification_sent_at` datetime DEFAULT NULL,
  `notification_error` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`affected_id`),
  UNIQUE KEY `uq_disruption_passenger` (`disruption_id`,`passenger_id`),
  KEY `ticket_id` (`ticket_id`),
  KEY `idx_disruption` (`disruption_id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_passenger` (`passenger_id`),
  KEY `idx_notification_status` (`notification_status`),
  CONSTRAINT `disruption_affected_passengers_ibfk_1` FOREIGN KEY (`disruption_id`) REFERENCES `flight_disruptions` (`disruption_id`) ON DELETE CASCADE,
  CONSTRAINT `disruption_affected_passengers_ibfk_2` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE RESTRICT,
  CONSTRAINT `disruption_affected_passengers_ibfk_3` FOREIGN KEY (`passenger_id`) REFERENCES `passengers` (`passenger_id`) ON DELETE RESTRICT,
  CONSTRAINT `disruption_affected_passengers_ibfk_4` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`ticket_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `audit_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `resource_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `resource_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_value` json DEFAULT NULL,
  `new_value` json DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('SUCCESS','FAILURE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SUCCESS',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`audit_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_resource` (`resource_type`,`resource_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `audit_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_messages (
  message_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  category VARCHAR(40) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new','reviewed','resolved') NOT NULL DEFAULT 'new',
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `itineraries` (
  `itinerary_id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `itinerary_reference` VARCHAR(30) NOT NULL UNIQUE,
  `user_id` INT NOT NULL,
  `trip_type` ENUM('oneway','return','multicity') NOT NULL,
  `class` VARCHAR(20) NOT NULL,
  `total_amount` DECIMAL(12,2) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `request_hash` VARCHAR(64) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_itinerary_user_key` (`user_id`,`idempotency_key`),
  CONSTRAINT `itinerary_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gate_audit_events` (
  `event_id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `flight_id` INT NULL,
  `booking_id` INT NULL,
  `passenger_id` INT NULL,
  `actor_user_id` INT NULL,
  `action` VARCHAR(40) NOT NULL,
  `outcome` ENUM('accepted','rejected') NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_gate_flight` (`flight_id`, `event_id`),
  CONSTRAINT `gate_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
