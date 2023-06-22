import { createClient } from "@redis/client";
import postgres from "postgres";

console.log("Connecting to Redis...");

// Default set for local development, see `compose.yaml`.
const redisUrl = process.env.REDIS_URL || "redis://localhost:7673";

export const redis = createClient({ url: redisUrl });

redis.on("error", console.error);
await redis.connect();

console.log("Connecting to Postgres...");

// Default set for local development, see `compose.yaml`.
const databaseUrl =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:7672";

export const sql = postgres(databaseUrl, { onnotice: () => {} });

await sql`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    version BIGINT NOT NULL
  );
`;
