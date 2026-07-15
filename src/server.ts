import dotenv from "dotenv";
dotenv.config();

import express, {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";
import cors from "cors";
import { ObjectId, Document, Collection } from "mongodb";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose-cjs";
import { connectDB, closeDB, getDB } from "./config/db";

const app = express();
const port: string | number = process.env.PORT || 8000;

// ENV VALIDATION (fail fast, don't crash mysteriously later)
const requiredEnvVars = ["MONGODB_URI", "DB_NAME", "CLIENT_URL"] as const;
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

//  MIDDLEWARE
app.use(
  cors({
    origin: process.env.CLIENT_URL, // restrict to your frontend only
    credentials: true,
  }),
);
app.use(express.json());

//  CUSTOM TYPES
interface AuthenticatedRequest extends Request {
  user?: JWTPayload & {
    role?: string;
    userId?: string;
    sub?: string;
  };
}

const asyncHandler =
  (
    fn: (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction,
    ) => Promise<void | Response>,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
  };

const validateObjectId = (id: unknown, res: Response): id is string => {
  if (typeof id !== "string" || !ObjectId.isValid(id)) {
    res.status(400).json({ error: true, message: "Invalid ID format" });
    return false;
  }
  return true;
};

// 💡 DYNAMIC MONGODB COLLECTION MANAGER (Fixes Serverless Crashing)
const getCollection = async <T extends Document = Document>(name: string): Promise<Collection<T>> => {
  try {
    const db = getDB();
    return db.collection<T>(name);
  } catch {
    const db = await connectDB();
    return db.collection<T>(name);
  }
};

// JWKS Setup
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// AUTH MIDDLEWARES
const verifyToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).json({ error: true, message: "Unauthorized" });
  }

  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: true, message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error);
    return res.status(401).json({ error: true, message: "Unauthorized" });
  }
};

const userVerify = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void | Response => {
  if (!req.user || req.user.role !== "user") {
    return res
      .status(403)
      .json({ error: true, message: "Forbidden: Users only" });
  }
  next();
};

const adminVerify = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void | Response => {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: true, message: "Forbidden: Admins only" });
  }
  next();
};

// ROOT ROUTE
app.get("/", (req: Request, res: Response) => {
  res.send("GlowUp Salon Booking TS Server is running...");
});

// ==========================================
//  SERVICES ROUTES (Public & Admin)
// ==========================================

// 1. Get All Services
app.get(
  "/api/services",
  asyncHandler(async (req, res) => {
    const servicesCollection = await getCollection("services");
    const search = (req.query.search as string) || "";
    const category = (req.query.category as string) || "";
    const minPrice = parseFloat(req.query.minPrice as string) || 0;
    const maxPrice = parseFloat(req.query.maxPrice as string) || Infinity;
    const sortBy = (req.query.sortBy as string) || "newest";

    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit as string) || 8, 1);
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (search) {
      query.title = { $regex: search, $options: "i" };
    }

    if (category && category !== "all") {
      query.category = { $regex: new RegExp(`^${category}$`, "i") };
    }

    query.price = { $gte: minPrice, $lte: maxPrice };

    const sortOptions: Record<string, 1 | -1> = {};
    if (sortBy === "price-low") {
      sortOptions.price = 1;
    } else if (sortBy === "price-high") {
      sortOptions.price = -1;
    } else if (sortBy === "rating") {
      sortOptions.rating = -1;
    } else {
      sortOptions.createdAt = -1;
    }

    const totalItems = await servicesCollection.countDocuments(query);
    const totalPages = Math.ceil(totalItems / limit);

    const result = await servicesCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      services: result,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  }),
);

// 2. Get Single Service Details
app.get(
  "/api/services/:id",
  asyncHandler(async (req, res) => {
    const servicesCollection = await getCollection("services");
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
    if (!service) {
      return res.status(404).json({ error: true, message: "Service not found" });
    }

    const relatedServices = await servicesCollection
      .find({ category: service.category, _id: { $ne: new ObjectId(id) } })
      .limit(3)
      .toArray();

    res.json({ service, relatedServices });
  }),
);

// 3. Add a New Service
app.post(
  "/api/services",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const servicesCollection = await getCollection("services");
    const { title, category, shortDescription, description, price, duration, rating, image } = req.body;

    if (!title || !category || price === undefined || duration === undefined) {
      return res.status(400).json({
        error: true,
        message: "title, category, price and duration are required",
      });
    }

    const parsedPrice = parseFloat(price);
    const parsedDuration = parseInt(duration);

    if (Number.isNaN(parsedPrice) || Number.isNaN(parsedDuration)) {
      return res.status(400).json({
        error: true,
        message: "price and duration must be valid numbers",
      });
    }

    const newService = {
      title,
      category,
      shortDescription,
      description,
      price: parsedPrice,
      duration: parsedDuration,
      rating: parseFloat(rating) || 5.0,
      image,
      createdAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);
    res.status(201).json({ success: true, result });
  }),
);

// 4. Update an existing Service
app.patch(
  "/api/services/:id",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const servicesCollection = await getCollection("services");
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const { title, category, shortDescription, description, price, duration, rating, image } = req.body;
    const updateFields: Record<string, unknown> = {};

    if (title !== undefined) updateFields.title = title;
    if (category !== undefined) updateFields.category = category;
    if (shortDescription !== undefined) updateFields.shortDescription = shortDescription;
    if (description !== undefined) updateFields.description = description;
    if (image !== undefined) updateFields.image = image;

    if (price !== undefined) {
      const parsedPrice = parseFloat(price);
      if (Number.isNaN(parsedPrice)) {
        return res.status(400).json({ error: true, message: "price must be a valid number" });
      }
      updateFields.price = parsedPrice;
    }

    if (duration !== undefined) {
      const parsedDuration = parseInt(duration);
      if (Number.isNaN(parsedDuration)) {
        return res.status(400).json({ error: true, message: "duration must be a valid number" });
      }
      updateFields.duration = parsedDuration;
    }

    if (rating !== undefined) {
      const parsedRating = parseFloat(rating);
      if (Number.isNaN(parsedRating)) {
        return res.status(400).json({ error: true, message: "rating must be a valid number" });
      }
      updateFields.rating = parsedRating;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: true, message: "No valid fields provided to update" });
    }

    updateFields.updatedAt = new Date();

    const result = await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: true, message: "Service not found" });
    }

    res.json({ success: true, result });
  }),
);

// 5. Delete a Service
app.delete(
  "/api/services/:id",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const servicesCollection = await getCollection("services");
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const result = await servicesCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  }),
);

// ==========================================
//  BOOKINGS ROUTES (User & Admin)
// ==========================================

// 1. Create Appointment / Booking
app.post(
  "/api/bookings",
  verifyToken,
  userVerify,
  asyncHandler(async (req, res) => {
    const bookingsCollection = await getCollection("bookings");
    const { serviceId, customerName, phoneNumber, bookingDate, timeSlot, notes, price } = req.body;

    if (!serviceId || !customerName || !phoneNumber || !bookingDate || !timeSlot) {
      return res.status(400).json({
        error: true,
        message: "serviceId, customerName, phoneNumber, bookingDate and timeSlot are required",
      });
    }

    if (!ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: true, message: "Invalid serviceId format" });
    }

    const userId = req.user?.sub || req.user?.userId;

    const bookingData = {
      userId,
      serviceId: new ObjectId(serviceId),
      customerName,
      phoneNumber,
      bookingDate: new Date(bookingDate),
      time: timeSlot,
      notes: notes || "",
      status: "pending",
      price: parseFloat(price) || 0,
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(bookingData);
    res.status(201).json({
      success: true,
      message: "Appointment booked successfully!",
      result,
    });
  }),
);

// 2. Get Logged-in User's Bookings
app.get(
  "/api/bookings/my-bookings",
  verifyToken,
  userVerify,
  asyncHandler(async (req, res) => {
    const bookingsCollection = await getCollection("bookings");
    const userId = req.user?.sub || req.user?.userId;

    const result = await bookingsCollection
      .aggregate([
        { $match: { userId } },
        { $sort: { bookingDate: -1 } },
        {
          $lookup: {
            from: "services",
            localField: "serviceId",
            foreignField: "_id",
            as: "serviceDetails",
          },
        },
        {
          $unwind: {
            path: "$serviceDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
      ])
      .toArray();

    res.json(result);
  }),
);

// ==========================================
//  DASHBOARD ANALYTICS ROUTE (Admin)
// ==========================================
app.get(
  "/api/admin/dashboard-analytics",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const servicesCollection = await getCollection("services");
    const bookingsCollection = await getCollection("bookings");
    let usersCollection;
    
    // safe collection fetching
    try {
      usersCollection = await getCollection("users");
    } catch (e) {
      console.warn("Users collection not available:", e);
    }

    const totalServices = await servicesCollection.countDocuments().catch(() => 0);
    const totalBookings = await bookingsCollection.countDocuments().catch(() => 0);
    
    // safe check count of users
    let totalCustomers = 0;
    if (usersCollection) {
      totalCustomers = await usersCollection.countDocuments({ role: "user" }).catch(() => 0);
    }

    const revenueData = await bookingsCollection
      .aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, totalRevenue: { $sum: "$price" } } },
      ])
      .toArray()
      .catch(() => []);

    const totalRevenue = revenueData[0]?.totalRevenue || 0;

    const monthlyChartData = await bookingsCollection
      .aggregate([
        {
          $group: {
            // "bookingDate" ফিল্ডটি টাইপ 'Date' কিনা তা নিশ্চিত করার জন্য safe aggregation
            _id: { $dateToString: { format: "%Y-%m", date: "$bookingDate" } },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { month: "$_id", bookings: 1, _id: 0 } },
      ])
      .toArray()
      .catch(() => []);

    res.json({
      stats: { totalServices, totalBookings, totalRevenue, totalCustomers },
      chartData: monthlyChartData,
    });
  }),
);

// ==========================================
// 📊 USER DASHBOARD ANALYTICS ROUTE (User only)
// ==========================================
app.get(
  "/api/user/dashboard-analytics",
  verifyToken,
  userVerify,
  asyncHandler(async (req, res) => {
    const bookingsCollection = await getCollection("bookings");
    const userId = req.user?.sub || req.user?.userId;

    const totalBookings = await bookingsCollection.countDocuments({ userId }).catch(() => 0);
    const pendingBookings = await bookingsCollection.countDocuments({ userId, status: "pending" }).catch(() => 0);
    const completedBookings = await bookingsCollection.countDocuments({ userId, status: "completed" }).catch(() => 0);

    // safe expense aggregation
    const expenseAggregation = await bookingsCollection
      .aggregate([
        { $match: { userId, status: "completed" } },
        { $group: { _id: null, totalSpent: { $sum: "$price" } } },
      ])
      .toArray()
      .catch(() => []);

    const totalSpent = expenseAggregation[0]?.totalSpent || 0;

    // safe monthly expense aggregation
    const monthlyExpense = await bookingsCollection
      .aggregate([
        { $match: { userId } },
        {
          $group: {
            // "bookingDate" ফিল্ডটি টাইপ 'Date' কিনা তা নিশ্চিত করার জন্য safe aggregation
            _id: { $dateToString: { format: "%Y-%m", date: "$bookingDate" } },
            amount: { $sum: "$price" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { month: "$_id", amount: 1, count: 1, _id: 0 } },
      ])
      .toArray()
      .catch(() => []);

    // safe category analysis
    const categoryAnalysis = await bookingsCollection
      .aggregate([
        { $match: { userId } },
        {
          $lookup: {
            from: "services",
            localField: "serviceId",
            foreignField: "_id",
            as: "serviceDetails",
          },
        },
        { $unwind: { path: "$serviceDetails", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$serviceDetails.category",
            value: { $sum: 1 },
          },
        },
        { $match: { _id: { $ne: null } } },
        { $project: { category: "$_id", value: 1, _id: 0 } },
        { $sort: { value: -1 } },
      ])
      .toArray()
      .catch(() => []);

    res.json({
      stats: { totalBookings, pendingBookings, completedBookings, totalSpent },
      charts: { monthlyExpense, categoryAnalysis },
    });
  }),
);

// ==========================================
//  USERS MANAGEMENT ROUTES (Admin)
// ==========================================
app.get(
  "/api/users",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const usersCollection = await getCollection("users");
    const users = await usersCollection.find().toArray();
    res.json(users);
  }),
);

app.patch(
  "/api/users/:id",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const usersCollection = await getCollection("users");
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const { role } = req.body;
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ error: true, message: "role must be 'user' or 'admin'" });
    }

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt: new Date() } },
    );
    res.json(result);
  }),
);

app.delete(
  "/api/users/:id",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const usersCollection = await getCollection("users");
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  }),
);

// 404 HANDLER
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: true, message: "Route not found" });
});

// CENTRALIZED ERROR HANDLER
app.use((err: Error & { status?: number }, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled Error:", err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || "Internal Server Error",
  });
});

// START SERVER
async function startServer(): Promise<void> {
  try {
    await connectDB();
  } catch (err) {
    console.error("Initial DB connection failed:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    app.listen(port, () => {
      console.log(`🚀 GlowUp TS Server listening on port ${port}`);
    });
  }
}

startServer();

process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await closeDB();
  process.exit(0);
});

export default app;