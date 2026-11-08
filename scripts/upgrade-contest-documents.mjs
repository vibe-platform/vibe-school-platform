import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const db = new PrismaClient();
const rows = JSON.parse(readFileSync('/app/contest-assets/document-upgrade.json','utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  for (const row of rows) {
    const record = await db.projectDocument.findUnique({where:{id:row.id}});
    if (!record || record.fileName !== row.fileName) continue;
    const path = '/app/data/uploads/' + row.fileName;
    let current;
    try { current = readFileSync(path); } catch { continue; }
    if (digest(current) !== row.oldHash) continue;
    const next = execFileSync('tar',['-xOf','/app/contest-assets/public-07.tar',row.fileName],{maxBuffer:20*1024*1024});
    if (next.length !== row.sizeBytes || next.subarray(0,5).toString() !== '%PDF-') throw new Error('Invalid contest document');
    writeFileSync(path+'.new',next); renameSync(path+'.new',path);
    await db.projectDocument.update({where:{id:row.id},data:{sizeBytes:row.sizeBytes}});
  }
} finally { await db.$disconnect(); }
