# Postman Testing Guide for JWT Authentication

## Prerequisites

1. **Start the Backend Server**
   ```bash
   cd backend
   python run.py
   ```
   The server should be running on `http://localhost:5000`

2. **Verify Admin User Exists**
   - If you haven't run the seed script yet:
     ```bash
     python backend/seed.py
     ```
   - Default admin credentials:
     - Email: `admin@example.com`
     - Password: `password123`

## Step-by-Step Testing Instructions

### Step 1: Login to Get JWT Token

**Request Details:**
- **Method:** `POST`
- **URL:** `http://localhost:5000/api/auth/login`
- **Headers:**
  - `Content-Type: application/json`
- **Body (raw JSON):**
  ```json
  {
    "email": "admin@example.com",
    "password": "password123"
  }
  ```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MzgwNzY4MDAsImlhdCI6MTczODA3NjgwMCwic3ViIjoiMTIzNDU2NzgtMTIzNC0xMjM0LTEyMzQtMTIzNDU2Nzg5MDEyIn0...",
    "user": {
      "id": "12345678-1234-1234-1234-123456789012",
      "full_name": "System Admin",
      "email": "admin@example.com",
      "role": "ADMIN",
      "is_active": true,
      "created_at": "2026-01-26T10:00:00Z",
      "updated_at": "2026-01-26T10:00:00Z"
    }
  }
}
```

**Important:** Copy the `token` value from the response. You'll need it for all subsequent requests.

---

### Step 2: Test Protected Endpoint - Get Current User

**Request Details:**
- **Method:** `GET`
- **URL:** `http://localhost:5000/api/auth/me`
- **Headers:**
  - `Authorization: Bearer <your-token-here>`
  - Replace `<your-token-here>` with the token you received in Step 1

**Example Header:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MzgwNzY4MDAsImlhdCI6MTczODA3NjgwMCwic3ViIjoiMTIzNDU2NzgtMTIzNC0xMjM0LTEyMzQtMTIzNDU2Nzg5MDEyIn0...
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "id": "12345678-1234-1234-1234-123456789012",
    "full_name": "System Admin",
    "email": "admin@example.com",
    "role": "ADMIN",
    "is_active": true,
    "created_at": "2026-01-26T10:00:00Z",
    "updated_at": "2026-01-26T10:00:00Z"
  }
}
```

---

### Step 3: Test Protected Endpoint - Get All Sites

**Request Details:**
- **Method:** `GET`
- **URL:** `http://localhost:5000/api/sites`
- **Headers:**
  - `Authorization: Bearer <your-token-here>`

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "Success",
  "data": [
    {
      "id": "...",
      "site_name": "...",
      "site_code": "...",
      "is_active": true,
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

**Testing Without Token (Should Fail):**
- Try the same request **without** the `Authorization` header
- **Expected Response (401 Unauthorized):**
  ```json
  {
    "message": "Token is missing",
    "success": false,
    "error": "Unauthorized"
  }
  ```

---

### Step 4: Test Protected Endpoint - Create a Site

**Request Details:**
- **Method:** `POST`
- **URL:** `http://localhost:5000/api/sites`
- **Headers:**
  - `Authorization: Bearer <your-token-here>`
  - `Content-Type: application/json`
- **Body (raw JSON):**
  ```json
  {
    "site_name": "Test Site",
    "site_code": "TS001"
  }
  ```

**Expected Response (201 Created):**
```json
{
  "success": true,
  "message": "Site created successfully",
  "data": {
    "id": "...",
    "site_name": "Test Site",
    "site_code": "TS001",
    "is_active": true,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

---

## Postman Collection Setup Tips

### Option 1: Manual Token Management

1. **Create a Collection Variable:**
   - In Postman, go to your Collection → Variables tab
   - Add a variable named `auth_token`
   - Leave the value empty initially

2. **After Login:**
   - Copy the token from the login response
   - Paste it into the `auth_token` collection variable

3. **Use in Requests:**
   - In the Authorization tab of each protected request, select "Bearer Token"
   - Enter `{{auth_token}}` as the token value

### Option 2: Automatic Token Extraction (Advanced)

1. **Add a Test Script to Login Request:**
   - In the login request, go to the "Tests" tab
   - Add this script:
   ```javascript
   if (pm.response.code === 200) {
       var jsonData = pm.response.json();
       pm.collectionVariables.set("auth_token", jsonData.data.token);
       console.log("Token saved:", jsonData.data.token);
   }
   ```

2. **Use Collection Variable:**
   - In all protected requests, use `{{auth_token}}` in the Authorization header

---

## Testing All Protected Endpoints

All the following endpoints require the `Authorization: Bearer <token>` header:

### Users API
- `GET /api/users` - Get all users
- `POST /api/users` - Create user
- `GET /api/users/{user_id}` - Get user by ID
- `PUT /api/users/{user_id}` - Update user
- `DELETE /api/users/{user_id}` - Delete user
- `POST /api/users/{user_id}/activate` - Activate user
- `POST /api/users/{user_id}/deactivate` - Deactivate user

### Sites API
- `GET /api/sites` - Get all sites
- `POST /api/sites` - Create site
- `GET /api/sites/{site_id}` - Get site by ID
- `PUT /api/sites/{site_id}` - Update site
- `DELETE /api/sites/{site_id}` - Delete site

### Employees API
- `GET /api/employees` - Get all employees
- `POST /api/employees` - Create employee
- `GET /api/employees/{employee_id}` - Get employee by ID
- `PUT /api/employees/{employee_id}` - Update employee
- `DELETE /api/employees/{employee_id}` - Delete employee
- `POST /api/employees/{employee_id}/activate` - Activate employee
- `POST /api/employees/{employee_id}/deactivate` - Deactivate employee

### Work Cards API
- `GET /api/work_cards` - Get work cards
- `GET /api/work_cards/{card_id}` - Get work card by ID
- `PUT /api/work_cards/{card_id}` - Update work card
- `PUT /api/work_cards/{card_id}/status` - Update status
- `POST /api/work_cards/{card_id}/approve` - Approve work card

---

## Common Error Responses

### 401 Unauthorized
**When:** Missing or invalid token
```json
{
  "message": "Token is missing",
  "success": false,
  "error": "Unauthorized"
}
```
or
```json
{
  "message": "Invalid token. Please log in again.",
  "success": false,
  "error": "Unauthorized"
}
```

### 401 Unauthorized - Expired Token
**When:** Token has expired (default: 24 hours)
```json
{
  "message": "Signature expired. Please log in again.",
  "success": false,
  "error": "Unauthorized"
}
```

### 403 Forbidden
**When:** Account is deactivated
```json
{
  "message": "Account is deactivated",
  "success": false,
  "error": "Forbidden"
}
```

---

## Quick Test Checklist

- [ ] Login with valid credentials → Get token
- [ ] Login with invalid credentials → 401 error
- [ ] Get `/api/auth/me` with valid token → Success
- [ ] Get `/api/auth/me` without token → 401 error
- [ ] Get `/api/sites` with valid token → Success
- [ ] Get `/api/sites` without token → 401 error
- [ ] Create site with valid token → Success
- [ ] Create site without token → 401 error
- [ ] Test with expired/invalid token → 401 error

---

## Notes

- **Token Expiration:** Tokens expire after 24 hours (86400 seconds) by default. You can change this in `.env` with `JWT_ACCESS_TOKEN_EXPIRES`.
- **Token Format:** The token is a JWT string. Always include it in the `Authorization` header as `Bearer <token>`.
- **No Token Required:** Only `/api/auth/login` does NOT require authentication.
- **All Other Endpoints:** Require the `Authorization: Bearer <token>` header.
