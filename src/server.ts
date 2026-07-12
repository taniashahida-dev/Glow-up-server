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
import { connectDB, closeDB } from "./config/db";

const app = express();
const port: string | number = process.env.PORT || 8000;


const requiredEnvVars = ["MONGODB_URI", "DB_NAME", "CLIENT_URL"] as const;
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(` Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ==========================================
//  MIDDLEWARE
// ==========================================
app.use(
  cors({
    origin: process.env.CLIENT_URL, // restrict to your frontend only
    credentials: true,
  }),
);
app.use(express.json());

// ==========================================
//  CUSTOM TYPES
// ==========================================

// Custom Request Interface to handle JWT Payload safely
interface AuthenticatedRequest extends Request {
  user?: JWTPayload & {
    role?: string;
    userId?: string;
    sub?: string;
  };
}

// Wraps async route handlers so we don't repeat try/catch everywhere
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

// ==========================================
//  MONGODB COLLECTIONS
// (populated once connectDB() resolves inside startServer())
// ==========================================
let usersCollection: Collection<Document>;
let servicesCollection: Collection<Document>;
let bookingsCollection: Collection<Document>;

// ==========================================
// JWKS Setup (Next.js / Clerk / Auth0 / custom JWKS endpoint)
// ==========================================
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// ==========================================
// AUTH MIDDLEWARES
// ==========================================

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

// ==========================================
// ROOT ROUTE
// ==========================================
app.get("/", (req: Request, res: Response) => {
  res.send("GlowUp Salon Booking TS Server is running...");
});

// ==========================================
// SERVICES ROUTES (Public & Admin)
// ==========================================

// 1. Get All Services — search, filter, sort, pagination
app.get(
  "/api/services",
  asyncHandler(async (req, res) => {
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

// 2. Get Single Service Details (Public)
app.get(
  "/api/services/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res
        .status(404)
        .json({ error: true, message: "Service not found" });
    }

    const relatedServices = await servicesCollection
      .find({ category: service.category, _id: { $ne: new ObjectId(id) } })
      .limit(3)
      .toArray();

    res.json({ service, relatedServices });
  }),
);

// 3. Add a New Service (Admin only)
app.post(
  "/api/services",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const {
      title,
      category,
      shortDescription,
      description,
      price,
      duration,
      rating,
      image,
    } = req.body;

    if (!title || !category || price === undefined || duration === undefined) {
      return res
        .status(400)
        .json({
          error: true,
          message: "title, category, price and duration are required",
        });
    }

    const parsedPrice = parseFloat(price);
    const parsedDuration = parseInt(duration);

    if (Number.isNaN(parsedPrice) || Number.isNaN(parsedDuration)) {
      return res
        .status(400)
        .json({
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
      duration: parsedDuration, // in minutes
      rating: parseFloat(rating) || 5.0,
      image,
      createdAt: new Date(),
    };

    const result = await servicesCollection.insertOne(newService);
    res.status(201).json({ success: true, result });
  }),
);

// 4. Delete a Service (Admin only)
app.delete(
  "/api/services/:id",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(id),
    });
    res.json(result);
  }),
);

// ==========================================
// BOOKINGS ROUTES (User & Admin)
// ==========================================

// 1. Create Appointment / Booking (User only)
app.post(
  "/api/bookings",
  verifyToken,
  userVerify,
  asyncHandler(async (req, res) => {
    const {
      serviceId,
      customerName,
      phoneNumber,
      bookingDate,
      timeSlot,
      notes,
      price,
    } = req.body;

    if (
      !serviceId ||
      !customerName ||
      !phoneNumber ||
      !bookingDate ||
      !timeSlot
    ) {
      return res.status(400).json({
        error: true,
        message:
          "serviceId, customerName, phoneNumber, bookingDate and timeSlot are required",
      });
    }

    if (!ObjectId.isValid(serviceId)) {
      return res
        .status(400)
        .json({ error: true, message: "Invalid serviceId format" });
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
    res
      .status(201)
      .json({
        success: true,
        message: "Appointment booked successfully!",
        result,
      });
  }),
);

// 2. Get Logged-in User's Bookings (User only)
app.get(
  "/api/bookings/my-bookings",
  verifyToken,
  userVerify,
  asyncHandler(async (req, res) => {
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



// USER DASHBOARD ANALYTICS ROUTE (User Only)
// ==========================================
app.get(
  "/api/user/dashboard-analytics",
  verifyToken,
  userVerify,
  asyncHandler(async (req, res) => {
    const userId = req.user?.sub || req.user?.userId;

  

    if (!userId) {
      return res.status(401).json({ error: true, message: "Unauthorized" });
    }


    const totalBookings = await bookingsCollection.countDocuments({ userId });
    const pendingBookings = await bookingsCollection.countDocuments({ userId, status: "pending" });
    const completedBookings = await bookingsCollection.countDocuments({ userId, status: "completed" });

    const spentData = await bookingsCollection
      .aggregate([
        { $match: { userId, status: "completed" } },
        { $group: { _id: null, totalSpent: { $sum: "$price" } } },
      ])
      .toArray();
    const totalSpent = spentData[0]?.totalSpent || 0;

    const monthlyExpense = await bookingsCollection
      .aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$bookingDate" } },
            amount: { $sum: "$price" },
            count: { $sum: 1 }
          },
        },
        { $sort: { _id: 1 } },
        { $project: { month: "$_id", amount: 1, count: 1, _id: 0 } },
      ])
      .toArray();

    const categoryAnalysis = await bookingsCollection
      .aggregate([
        { $match: { userId } },
        {
          $lookup: {
            from: "services",
            localField: "serviceId",
            foreignField: "_id",
            as: "service"
          }
        },
        { $unwind: "$service" },
        {
          $group: {
            _id: "$service.category",
            value: { $sum: 1 }
          }
        },
        { $project: { category: "$_id", value: 1, _id: 0 } }
      ])
      .toArray();

    
    res.json({
      stats: {
        totalBookings,
        pendingBookings,
        completedBookings,
        totalSpent,
      },
      charts: {
        monthlyExpense,    
        categoryAnalysis   
      }
    });
  }),
);

// ==========================================
// DASHBOARD ANALYTICS ROUTE (Admin)
// ==========================================
app.get(
  "/api/admin/dashboard-analytics",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const totalServices = await servicesCollection.countDocuments();
    const totalBookings = await bookingsCollection.countDocuments();
    const totalCustomers = await usersCollection.countDocuments({
      role: "user",
    });

    const revenueData = await bookingsCollection
      .aggregate([
        { $match: { status: "completed" } },
        { $group: { _id: null, totalRevenue: { $sum: "$price" } } },
      ])
      .toArray();

    const totalRevenue = revenueData[0]?.totalRevenue || 0;

    const monthlyChartData = await bookingsCollection
      .aggregate([
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$bookingDate" } },
            bookings: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { month: "$_id", bookings: 1, _id: 0 } },
      ])
      .toArray();

    res.json({
      stats: { totalServices, totalBookings, totalRevenue, totalCustomers },
      chartData: monthlyChartData,
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
    const users = await usersCollection.find().toArray();
    res.json(users);
  }),
);

app.patch(
  "/api/users/:id",
  verifyToken,
  adminVerify,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const { role } = req.body;
    if (!["user", "admin"].includes(role)) {
      return res
        .status(400)
        .json({ error: true, message: "role must be 'user' or 'admin'" });
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
    const { id } = req.params;
    if (!validateObjectId(id, res)) return;

    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
    res.json(result);
  }),
);

// ==========================================
// 404 HANDLER (unmatched routes)
// ==========================================
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: true, message: "Route not found" });
});

// ==========================================
// CENTRALIZED ERROR HANDLER
// (every asyncHandler catch lands here)
// ==========================================
app.use(
  (
    err: Error & { status?: number },
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    console.error("Unhandled Error:", err);
    res.status(err.status || 500).json({
      error: true,
      message: err.message || "Internal Server Error",
    });
  },
);

// ==========================================
// START SERVER (connect DB first, then listen)
// ==========================================
async function startServer(): Promise<void> {
  const db = await connectDB();

  usersCollection = db.collection<Document>("users");
  servicesCollection = db.collection<Document>("services");
  bookingsCollection = db.collection<Document>("bookings");

  app.listen(port, () => {
    console.log(`🚀 GlowUp TS Server listening on port ${port}`);
  });
}

startServer();

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await closeDB();
  process.exit(0);
});

export default app;
