--
-- Immobiliare.it Scraper Database Schema (Tier 1)
-- PostgreSQL schema for raw data storage, change tracking, and adaptive scheduling
--

-- Scrape runs tracking
CREATE TABLE IF NOT EXISTS scrape_runs (
  id SERIAL PRIMARY KEY,
  run_type VARCHAR(20) NOT NULL, -- 'city', 'search'
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL, -- 'running', 'completed', 'failed'
  properties_discovered INTEGER DEFAULT 0,
  properties_changed INTEGER DEFAULT 0,
  properties_unchanged INTEGER DEFAULT 0,
  properties_new INTEGER DEFAULT 0,
  properties_inactive INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  duration_seconds NUMERIC(10,2),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_scrape_runs_started ON scrape_runs(started_at DESC);
CREATE INDEX idx_scrape_runs_status ON scrape_runs(status);

-- Property snapshots (raw data from each scrape)
CREATE TABLE IF NOT EXISTS property_snapshots (
  id SERIAL PRIMARY KEY,
  portal_id VARCHAR(100) NOT NULL,
  scraped_at TIMESTAMP NOT NULL,
  raw_data JSONB NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  price NUMERIC(12,2),
  status VARCHAR(50),
  transaction_type VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_snapshots_portal_id ON property_snapshots(portal_id);
CREATE INDEX idx_snapshots_scraped_at ON property_snapshots(scraped_at DESC);
CREATE INDEX idx_snapshots_checksum ON property_snapshots(checksum);
CREATE INDEX idx_snapshots_price ON property_snapshots(price);

-- Property changes tracking
CREATE TABLE IF NOT EXISTS property_changes (
  id SERIAL PRIMARY KEY,
  portal_id VARCHAR(100) NOT NULL,
  changed_at TIMESTAMP NOT NULL,
  change_type VARCHAR(50) NOT NULL, -- 'price', 'status', 'description', 'images', etc.
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  snapshot_id INTEGER REFERENCES property_snapshots(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_changes_portal_id ON property_changes(portal_id);
CREATE INDEX idx_changes_changed_at ON property_changes(changed_at DESC);
CREATE INDEX idx_changes_type ON property_changes(change_type);

-- Property metadata (aggregated stats per property)
CREATE TABLE IF NOT EXISTS property_metadata (
  portal_id VARCHAR(100) PRIMARY KEY,
  first_seen TIMESTAMP NOT NULL,
  last_seen TIMESTAMP NOT NULL,
  last_changed TIMESTAMP,
  current_status VARCHAR(50),
  current_price NUMERIC(12,2),
  scrape_count INTEGER DEFAULT 1,
  change_count INTEGER DEFAULT 0,
  change_rate NUMERIC(5,4) DEFAULT 0, -- Changes per scrape (0.0 to 1.0)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metadata_last_seen ON property_metadata(last_seen DESC);
CREATE INDEX idx_metadata_change_rate ON property_metadata(change_rate DESC);
CREATE INDEX idx_metadata_status ON property_metadata(current_status);

-- Geographic areas (Italian cities/regions)
CREATE TABLE IF NOT EXISTS geographic_areas (
  id SERIAL PRIMARY KEY,
  area_name VARCHAR(100) UNIQUE NOT NULL,
  area_type VARCHAR(20) NOT NULL, -- 'city', 'region'
  change_rate NUMERIC(5,4) DEFAULT 0,
  scrape_interval_hours INTEGER DEFAULT 6,
  last_scraped TIMESTAMP,
  next_scrape TIMESTAMP,
  total_properties INTEGER DEFAULT 0,
  active_properties INTEGER DEFAULT 0,
  avg_changes_per_scrape NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_areas_next_scrape ON geographic_areas(next_scrape);
CREATE INDEX idx_areas_change_rate ON geographic_areas(change_rate DESC);
CREATE INDEX idx_areas_type ON geographic_areas(area_type);

-- Scraper health monitoring
CREATE TABLE IF NOT EXISTS scraper_health (
  id SERIAL PRIMARY KEY,
  checked_at TIMESTAMP NOT NULL,
  redis_connected BOOLEAN,
  postgres_connected BOOLEAN,
  queue_depth INTEGER,
  processed_count INTEGER,
  failed_count INTEGER,
  worker_count INTEGER,
  avg_processing_time_ms NUMERIC(10,2),
  errors_last_hour INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_health_checked_at ON scraper_health(checked_at DESC);

-- Create view for quick stats
CREATE OR REPLACE VIEW scraper_stats AS
SELECT
  (SELECT COUNT(*) FROM property_snapshots) as total_snapshots,
  (SELECT COUNT(*) FROM property_changes) as total_changes,
  (SELECT COUNT(*) FROM property_metadata) as total_properties,
  (SELECT COUNT(*) FROM property_metadata WHERE current_status = 'active') as active_properties,
  (SELECT AVG(change_rate) FROM property_metadata) as avg_change_rate,
  (SELECT MAX(scraped_at) FROM property_snapshots) as last_scrape_time,
  (SELECT COUNT(*) FROM scrape_runs WHERE status = 'running') as active_runs;

-- Insert default geographic areas for Italian cities
INSERT INTO geographic_areas (area_name, area_type, scrape_interval_hours) VALUES
  ('milano', 'city', 6),
  ('roma', 'city', 6),
  ('napoli', 'city', 6),
  ('torino', 'city', 6),
  ('firenze', 'city', 6),
  ('bologna', 'city', 6),
  ('genova', 'city', 6),
  ('palermo', 'city', 6),
  ('venezia', 'city', 6),
  ('verona', 'city', 6)
ON CONFLICT (area_name) DO NOTHING;
