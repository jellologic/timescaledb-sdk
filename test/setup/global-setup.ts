// Global test setup - runs before all test files
// This file is loaded via bunfig.toml preload

// Set test environment
process.env.NODE_ENV = "test"

// Increase default timeout for Effect operations
process.env.EFFECT_TEST_TIMEOUT = "30000"
