import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const count = await db.assignment.count();
  if (count !== 0) throw new Error('Expected zero assignments on clean start; got ' + count);
  console.log('Initial assignment count:', count);
} finally { await db.$disconnect(); }
