import { MongoClient, Db } from "mongodb"; // type-only import ঝামেলা এড়াতে সরাসরি import
import dotenv from "dotenv";

dotenv.config();

const uri = process.env["MONGODB_URI"] as string;
const dbName = process.env["DB_NAME"] as string;

const client = new MongoClient(uri);

let db: Db | undefined;

export const connectDB = async (): Promise<Db> => {
  try {
    await client.connect();
    db = client.db(dbName);
    console.log("MongoDB connected successfully");
    return db;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};

export const getDB = (): Db => {
  if (!db) {
    throw new Error("Database not initialized. Call connectDB first.");
  }
  return db;
};