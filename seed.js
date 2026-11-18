import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGODB_URI must be set before seeding the database.');
}

const databaseName = process.env.DB_NAME || 'after_school';
const client = new MongoClient(uri);

try {
  await client.connect();
  const database = client.db(databaseName);
  for (const collectionName of ['lessons', 'teachers', 'orders']) {
    const collection = database.collection(collectionName);
    if (await collection.countDocuments() > 0) continue;

    const documents = JSON.parse(await readFile(new URL(`./data/${collectionName}.json`, import.meta.url), 'utf8'));
    if (documents.length > 0) {
      await collection.insertMany(documents);
      console.log(`Seeded ${documents.length} documents into ${collectionName}.`);
    }
  }
} finally {
  await client.close();
}
