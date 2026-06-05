import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const mongoUrl = process.env.MONGO_URL || process.env.MONGO_URI;
    if (!mongoUrl) {
      throw new Error("Mongo URL not found! Check your .env");
    }

    if (mongoose.connection.readyState === 1) {
      return mongoose.connection;
    }

    const connect = await mongoose.connect(mongoUrl);

    console.log(`MongoDB connected: ${connect.connection.host}`);
  } catch (err) {
    console.error("MongoDB error:", err.message);
    if (process.env.VERCEL === "1") {
      throw err;
    }
    process.exit(1);
  }
};

export default connectDB;
