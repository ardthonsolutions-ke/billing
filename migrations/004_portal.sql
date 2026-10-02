SET NAMES utf8mb4;

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  subscriber_id INT DEFAULT NULL,
  plan_id INT DEFAULT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  method ENUM('manual','mpesa_stk','mpesa_c2b','cash','bank') NOT NULL DEFAULT 'manual',
  status ENUM('pending','completed','failed','cancelled') DEFAULT 'pending',
  reference VARCHAR(100) DEFAULT NULL,
  mpesa_receipt VARCHAR(50) DEFAULT NULL,
  mpesa_phone VARCHAR(30) DEFAULT NULL,
  notes VARCHAR(500) DEFAULT NULL,
  recorded_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL,
  INDEX idx_tenant (tenant_id),
  INDEX idx_subscriber (subscriber_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(id) ON DELETE SET NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Subscriber portal additions
ALTER TABLE subscribers
  ADD COLUMN last_payment_at DATETIME DEFAULT NULL,
  ADD COLUMN last_login_at DATETIME DEFAULT NULL,
  ADD COLUMN login_count INT DEFAULT 0;
