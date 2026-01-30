import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

// API base URL - direct to Flask in development, relative in production
const API_BASE_URL = import.meta.env.DEV 
  ? 'http://localhost:5000/api' 
  : '/api';

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [500, 502, 503, 504],
};

// Request timeout (15 seconds)
const REQUEST_TIMEOUT_MS = 15000;

// Extend config type to include retry metadata
interface RetryConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

// Check if error is retryable
const isRetryableError = (error: AxiosError): boolean => {
  // Network errors (ECONNREFUSED, timeout, etc.)
  if (!error.response) {
    return true;
  }
  // Server errors (5xx)
  if (error.response.status && RETRY_CONFIG.retryableStatuses.includes(error.response.status)) {
    return true;
  }
  return false;
};

// Calculate delay with exponential backoff + jitter
const getRetryDelay = (retryCount: number): number => {
  const exponentialDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, retryCount);
  const jitter = Math.random() * 500; // Add up to 500ms jitter
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelayMs);
};

// Sleep utility
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add auth token
client.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors and retry logic
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    
    // If no config or request was cancelled, don't retry
    if (!config) {
      return Promise.reject(error);
    }

    // Initialize retry count
    config.__retryCount = config.__retryCount ?? 0;

    // Check if we should retry
    if (isRetryableError(error) && config.__retryCount < RETRY_CONFIG.maxRetries) {
      config.__retryCount += 1;
      
      const delay = getRetryDelay(config.__retryCount);
      console.log(`[API] Retry ${config.__retryCount}/${RETRY_CONFIG.maxRetries} for ${config.url} after ${Math.round(delay)}ms`);
      
      await sleep(delay);
      return client.request(config);
    }

    // Handle 401 - unauthorized
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // Ideally redirect to login or update auth state via event
    }

    return Promise.reject(error);
  }
);

export default client;
