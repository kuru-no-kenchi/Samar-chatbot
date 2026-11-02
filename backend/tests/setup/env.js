process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';
process.env.CLIENT_ORIGIN = 'http://localhost:4200';
process.env.DISABLE_RATE_LIMIT = 'true';
process.env.LLM_API_KEY = 'test';
process.env.LLM_BASE_URL = 'http://localhost:0';
process.env.LLM_MODEL = 'test-model';