<div align="center">

# ⚙️ GlowUp – Salon Booking System (Backend)

### Secure REST API Server

This backend powers the **GlowUp Salon Booking System**, providing REST APIs for salon service management, appointment bookings, role-based access control, and admin/user analytics — built with **Node.js**, **Express.js**, **TypeScript**, and **MongoDB**, and secured with **JWT verification via JWKS**.

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![JWT](https://img.shields.io/badge/JWT-black?style=for-the-badge&logo=JSON%20web%20tokens)](https://jwt.io/)



</div>

---

## 📖 API Overview

The **GlowUp Backend** is a REST API server built with **Express** and **TypeScript**, using the native **MongoDB driver** (no ODM). It handles:

- 💅 **Salon services** — search, filter, sort, pagination, create, update, delete
- 📅 **Appointment bookings** — create bookings and fetch a user's own booking history (with service details joined via aggregation)
- 📊 **Analytics dashboards** — separate stats/chart endpoints for admins and regular users
- 👥 **User management** — list users, update roles, remove accounts (admin-only)
- 🔐 **Role-based route protection** — `verifyToken`, `userVerify`, and `adminVerify` middleware guard sensitive endpoints
- 🧯 **Fail-fast startup** — required environment variables are validated before the server boots
- ♻️ **Serverless-safe DB access** — a `getCollection()` helper reconnects automatically if the cached connection is unavailable

> ℹ️ **Note on authentication:** This server does **not** issue its own JWTs or expose `/register` / `/login` routes. Instead, it **verifies** incoming tokens against a remote JWKS endpoint (`${CLIENT_URL}/api/auth/jwks`) using the `jose-cjs` library — meaning token issuance (login/registration/password hashing) is handled by the frontend's auth provider (e.g. NextAuth), and this backend acts purely as a resource server that trusts and validates those tokens.

---

## 🌐 Live API

| Environment | Link |
|---|---|
| ⚙️ Backend URL | (https://glow-up-server-three.vercel.app) |

---

## 📦 GitHub Repository

| Repository | Link |
|---|---|
| ⚙️ Backend Repository | (https://github.com/taniashahida-dev/Glow-up-server) |

---

## 🛠️ Technologies Used

| Category | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express.js |
| Language | TypeScript |
| Database | MongoDB (native driver) |
| Token Verification | `jose-cjs` (JWKS-based JWT verification) |
| Environment Config | dotenv |
| Cross-Origin Support | cors |

---


> 📌 The current entry file defines all routes inline. The structure above reflects a suggested modular breakdown if the codebase grows further.

---

## ⚙️ Installation

### 1️⃣ Clone the repository
```bash
git clone https://github.com/taniashahida-dev/Glow-up-server
cd glowup-backend
```

### 2️⃣ Install dependencies
```bash
npm install
```

### 3️⃣ Set up environment variables
Create a `.env` file in the root directory (see [Environment Variables](#-environment-variables) below).

### 4️⃣ Run the development server
```bash
npm run dev
```

### 5️⃣ Server running at
```
http://localhost:8000
```

---

## 🔑 Environment Variables

Create a `.env` file in the root directory and add the following. The server **validates these at startup** and exits immediately if any are missing.

```env
PORT=8000
MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
DB_NAME=YOUR_DATABASE_NAME
CLIENT_URL=YOUR_FRONTEND_URL
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | Optional (defaults to `8000`) | Port the Express server listens on |
| `MONGODB_URI` | ✅ Yes | MongoDB connection string |
| `DB_NAME` | ✅ Yes | Name of the MongoDB database to use |
| `CLIENT_URL` | ✅ Yes | Frontend origin — used for CORS **and** as the base URL for the JWKS endpoint (`${CLIENT_URL}/api/auth/jwks`) |

> ⚠️ **Note:** Never commit your `.env` file to version control. Make sure it is listed in `.gitignore`.

---

## 🔗 API Endpoints

### 💅 Services

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/services` | Get all services — supports `search`, `category`, `minPrice`, `maxPrice`, `sortBy`, `page`, `limit` query params | 🌍 Public |
| `GET` | `/api/services/:id` | Get a single service by ID, plus up to 3 related services from the same category | 🌍 Public |
| `POST` | `/api/services` | Add a new service | 🔒 Admin |
| `PATCH` | `/api/services/:id` | Update an existing service (partial update) | 🔒 Admin |
| `DELETE` | `/api/services/:id` | Delete a service | 🔒 Admin |

### 📅 Bookings

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `POST` | `/api/bookings` | Book an appointment for a given `serviceId` | 🔒 User |
| `GET` | `/api/bookings/my-bookings` | Get the logged-in user's bookings, joined with service details | 🔒 User |

### 📊 Analytics

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/admin/dashboard-analytics` | Total services, bookings, revenue, and customers, plus monthly booking chart data | 🔒 Admin |
| `GET` | `/api/user/dashboard-analytics` | User's total/pending/completed bookings, total spend, monthly spend chart, and category breakdown | 🔒 User |

### 👥 Users

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/api/users` | Get all users | 🔒 Admin |
| `PATCH` | `/api/users/:id` | Update a user's role (`user` or `admin`) | 🔒 Admin |
| `DELETE` | `/api/users/:id` | Delete a user | 🔒 Admin |

### 🩺 Health Check

| Method | Endpoint | Description | Access |
|---|---|---|---|
| `GET` | `/` | Basic health check — confirms the server is running | 🌍 Public |

---

## 🔐 Authentication

Unlike a typical Express API that issues its own tokens, **this backend delegates token issuance to the frontend** and only handles **verification**.

**How it works:**

1. 🔑 **Token Issuance (external)** — The frontend's auth provider (e.g. NextAuth) authenticates the user and signs a JWT, exposing its public signing keys at `${CLIENT_URL}/api/auth/jwks`.
2. 📤 **Token Delivery** — The client includes the token in the `Authorization` header on every request to protected routes:
   ```
   Authorization: Bearer <token>
   ```
3. 🌐 **Remote Key Fetching** — On the backend, `createRemoteJWKSet()` from `jose-cjs` lazily fetches and caches the frontend's public keys from the JWKS endpoint.
4. 🛡️ **Verification Middleware** — `verifyToken` extracts the bearer token, verifies its signature and expiry against the JWKS, and attaches the decoded payload to `req.user`. Requests with a missing or invalid token receive a `401 Unauthorized`.
5. 🧑‍⚖️ **Role Enforcement** — After verification, `userVerify` or `adminVerify` middleware checks `req.user.role` and returns `403 Forbidden` if the caller's role doesn't match what the route requires.

---

## 🗄️ Database Collections

| Collection | Description |
|---|---|
| 👤 `users` | User accounts and roles (`user` / `admin`) — managed via `/api/users` endpoints |
| 💅 `services` | Salon service details — title, category, price, duration, rating, description, image |
| 📅 `bookings` | Appointment bookings — linked to a `userId` and `serviceId`, with status (`pending` / `completed`) |

---

## 🛡️ Security Features

- 🔒 **JWT Verification via JWKS** — tokens are validated against the frontend's public keys rather than a shared secret, avoiding secret duplication between services
- 🧑‍⚖️ **Role-Based Access Control** — `userVerify` and `adminVerify` middleware restrict endpoints by role
- 🌐 **Locked-Down CORS** — `origin` is restricted to `CLIENT_URL` with `credentials: true`, rather than allowing all origins
- 🧾 **Fail-Fast Environment Validation** — the server exits immediately at startup if `MONGODB_URI`, `DB_NAME`, or `CLIENT_URL` are missing
- ✅ **ObjectId Validation** — all `:id` route params are validated before hitting the database, returning `400` on malformed IDs
- 🧯 **Centralized Error Handling** — a catch-all error middleware formats unhandled errors consistently and avoids leaking stack traces
- ♻️ **Resilient DB Access** — `getCollection()` transparently reconnects if the cached MongoDB connection is unavailable (important in serverless environments)
- 🔌 **Graceful Shutdown** — `SIGINT` closes the MongoDB connection cleanly before the process exits

---

## 🔐 Demo Credentials

Use the following demo accounts to test the API without registering:

### 👤 User Account
| Field | Value |
|---|---|
| Email | `taniia.webdev1@gmail.com` |
| Password | `taniia.webdev1@gmail.com` |

### 🛡️ Admin Account
| Field | Value |
|---|---|
| Email | `admin@gmail.com` |
| Password | `admin@gmail.com` |

> Since token issuance lives on the frontend, these credentials are used to log in **through the frontend app**, which then obtains a JWT this backend will accept.

---

## ❗ Error Handling

All API errors follow a consistent JSON response format:

```json
{
  "error": true,
  "message": "Service not found"
}
```

| Status Code | Meaning |
|---|---|
| `400` | Bad Request — invalid input, malformed ObjectId, or non-numeric price/duration/rating |
| `401` | Unauthorized — missing, invalid, or expired JWT |
| `403` | Forbidden — authenticated but wrong role (`user` vs `admin`) |
| `404` | Not Found — resource or route does not exist |
| `500` | Internal Server Error — unexpected server failure |

Errors are handled in two layers:
- **Not-found routes** are caught by a catch-all `404` handler.
- **Thrown/async errors** are caught by `asyncHandler` and forwarded to a centralized Express error-handling middleware, which logs the error server-side and returns a clean JSON response to the client.

---

## 🚀 Future Improvements

- 💳 Payment Gateway Integration (SSLCommerz / Stripe)
- 📧 Email Notifications for Booking Confirmations
- 🔄 Booking Status Update Endpoint (e.g. mark as completed/cancelled)
- 🗃️ Rate Limiting on Public Endpoints
- 🧪 Automated Testing (Jest / Supertest)
- 📜 Swagger/OpenAPI Documentation
- 🧱 Modularize routes into separate controller/service files per resource

---

## 👩‍💻 Author

**Tania Shahida**

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/taniashahida-dev)

---


<div align="center">

Made with ❤️ by **Tania Shahida**

⭐ Don't forget to star this repo if you found it helpful!

</div>
