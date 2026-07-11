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
// import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose-cjs";
import { connectDB, closeDB } from "./config/db";

const app = express();
const port: string | number = process.env.PORT || 8000;

// ==========================================
// 🔒 ENV VALIDATION (fail fast, don't crash mysteriously later)
// ==========================================
const requiredEnvVars = ["MONGODB_URI", "DB_NAME", "CLIENT_URL"] as const;
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

app.use(
  cors({
    origin: process.env.CLIENT_URL, // restrict to your frontend only
    credentials: true,
  }),
);
app.use(express.json());

const validateObjectId = (id: string, res: Response): boolean => {
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: true, message: "Invalid ID format" });
    return false;
  }
  return true;
};

let usersCollection: Collection<Document>;
let servicesCollection: Collection<Document>;
let bookingsCollection: Collection<Document>;

app.get("/", (req: Request, res: Response) => {
  res.send("GlowUp Salon Booking TS Server is running...");
});

// ==========================================
// 💇 SERVICES ROUTES (Public & Admin)
// ==========================================

// 1. Get All Services — search, filter, sort, pagination
app.get("/api/services", async (req, res) => {
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
});

// 2. Get Single Service Details (Public)
app.get("/api/services/:id", async (req, res) => {
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
});

// 3. Add a New Service (Admin only)
app.post(
  "/api/services",

  async (req, res) => {
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
  },
);

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

process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await closeDB();
  process.exit(0);
});

export default app;
