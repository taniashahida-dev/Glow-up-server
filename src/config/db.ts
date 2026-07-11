import { MongoClient, Db, ServerApiVersion } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env["MONGODB_URI"] as string;
const dbName = process.env["DB_NAME"] as string;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db: Db | undefined;

export const connectDB = async (): Promise<Db> => {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log("💅 MongoDB connected successfully");
    return db;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

export const getDB = (): Db => {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB first.");
  }
  return db;
};

// Used for graceful shutdown (SIGINT handler in server.ts)
export const closeDB = async (): Promise<void> => {
  await client.close();
};