import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  // A connection is opened lazily on the first query. The fallback lets Next.js
  // analyze route modules during an image build; Compose supplies the real URL.
  const connectionString =
    process.env.DATABASE_URL ?? "postgresql://chatbot:chatbot@database:5432/recipe_chat?schema=public";

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
