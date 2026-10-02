-- ═══════════════════════════════════════════════════════════
-- Migration 006 — Tickets + Leads
-- ═══════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ── Tickets ──
CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  subscriber_id INT DEFAULT NULL,
  ticket_number VARCHAR(30) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  category VARCHAR(50) DEFAULT 'general',
  priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
  status ENUM('open','pending','resolved','closed') DEFAULT 'open',
  contact_name VARCHAR(150) DEFAULT NULL,
  contact_phone VARCHAR(30) DEFAULT NULL,
  contact_email VARCHAR(150) DEFAULT NULL,
  assigned_to INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME DEFAULT NULL,
  UNIQUE KEY uniq_tenant_ticket (tenant_id, ticket_number),
  INDEX idx_tenant (tenant_id),
  INDEX idx_status (status),
  INDEX idx_priority (priority),
  INDEX idx_subscriber (subscriber_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Ticket messages (thread) ──
CREATE TABLE IF NOT EXISTS ticket_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  sender_type ENUM('subscriber','staff','system') NOT NULL,
  sender_id INT DEFAULT NULL,
  sender_name VARCHAR(150) DEFAULT NULL,
  body TEXT NOT NULL,
  is_internal TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ticket (ticket_id),
  INDEX idx_created (created_at),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Leads ──
CREATE TABLE IF NOT EXISTS leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(150) DEFAULT NULL,
  location VARCHAR(200) DEFAULT NULL,
  source VARCHAR(80) DEFAULT 'walk-in',
  interest VARCHAR(200) DEFAULT NULL,
  status ENUM('new','contacted','qualified','converted','lost') DEFAULT 'new',
  priority ENUM('low','normal','high') DEFAULT 'normal',
  assigned_to INT DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  follow_up_at DATETIME DEFAULT NULL,
  converted_subscriber_id INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_status (status),
  INDEX idx_phone (phone),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (converted_subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Lead activity log ──
CREATE TABLE IF NOT EXISTS lead_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  notes VARCHAR(500) DEFAULT NULL,
  user_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lead (lead_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
