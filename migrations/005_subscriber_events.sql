-- Migration 005 — add missing subscriber_events table
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS subscriber_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  subscriber_id INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  details JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tenant (tenant_id),
  INDEX idx_subscriber (subscriber_id),
  INDEX idx_type (event_type),
  INDEX idx_created (created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
