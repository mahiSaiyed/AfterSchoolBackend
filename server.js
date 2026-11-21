import 'dotenv/config';
import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const app = express();
const port = Number(process.env.PORT) || 3000;
const databaseName = process.env.DB_NAME || 'after_school';
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  throw new Error('MONGODB_URI must be set before starting the server.');
}

const mongoClient = new MongoClient(mongoUri);
await mongoClient.connect();
const database = mongoClient.db(databaseName);

async function seedEmptyCollections() {
  for (const collectionName of ['lessons', 'teachers', 'orders']) {
    const collection = database.collection(collectionName);
    if (await collection.countDocuments() > 0) continue;
    const documents = JSON.parse(await readFile(
      new URL(`./data/${collectionName}.json`, import.meta.url),
      'utf8',
    ));
    if (documents.length > 0) await collection.insertMany(documents);
  }
}

await seedEmptyCollections();

app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on('finish', () => {
    console.log(`${new Date().toISOString()} ${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
});

app.use('/images', express.static(path.join(currentDirectory, 'public', 'images')));
app.use('/images', (request, response) => response.status(404).json({ error: 'Image not found.' }));

function handleRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

async function getLessons(request) {
  const filter = {};
  if (request.query.teacherId) {
    const teacher = await database.collection('teachers').findOne({ _id: request.query.teacherId });
    if (!teacher) return [];
    filter._id = { $in: teacher.lessonIds };
  }

  const lessons = await database.collection('lessons').find(filter).toArray();
  return Promise.all(lessons.map(async (lesson) => {
    const teachers = await database.collection('teachers')
      .find({ _id: { $in: lesson.teacherIds || [] } })
      .project({ firstName: 1, lastName: 1 })
      .toArray();
    return { ...lesson, teachers };
  }));
}

app.get('/lessons', handleRoute(async (request, response) => {
  response.json(await getLessons(request));
}));

app.get('/search', handleRoute(async (request, response) => {
  const query = String(request.query.q || '').trim().toLocaleLowerCase();
  const lessons = await getLessons(request);
  if (!query) return response.json(lessons);
  response.json(lessons.filter((lesson) => [
    lesson.topic,
    lesson.title,
    lesson.location,
    String(lesson.price),
    String(lesson.space),
  ].some((value) => String(value || '').toLocaleLowerCase().includes(query))));
}));

app.get('/teachers', handleRoute(async (request, response) => {
  response.json(await database.collection('teachers').find().toArray());
}));

app.post('/orders', handleRoute(async (request, response) => {
  const { name, phoneNumber, lessonIDs, space, items } = request.body || {};
  if (typeof name !== 'string' || !/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(name.trim())) {
    return response.status(400).json({ error: 'Name must contain letters and spaces only.' });
  }
  if (typeof phoneNumber !== 'string' || !/^\d+$/.test(phoneNumber)) {
    return response.status(400).json({ error: 'Phone number must contain digits only.' });
  }
  if (!Array.isArray(lessonIDs) || lessonIDs.length === 0 ||
      !Array.isArray(items) || items.length === 0 ||
      !Number.isInteger(space) || space < 1 ||
      items.some((item) => typeof item.lessonId !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1) ||
      items.reduce((total, item) => total + item.quantity, 0) !== space ||
      lessonIDs.length !== items.length ||
      !lessonIDs.every((id) => items.some((item) => item.lessonId === id))) {
    return response.status(400).json({ error: 'Order must include valid lesson IDs, quantities, and total spaces.' });
  }

  const existingLessons = await database.collection('lessons')
    .countDocuments({ _id: { $in: lessonIDs } });
  if (existingLessons !== new Set(lessonIDs).size) {
    return response.status(400).json({ error: 'One or more lessons do not exist.' });
  }

  const order = { name: name.trim(), phoneNumber, lessonIDs, space, items, createdAt: new Date() };
  const result = await database.collection('orders').insertOne(order);
  response.status(201).json({ ...order, _id: result.insertedId });
}));

app.put('/lessons/:id', handleRoute(async (request, response) => {
  const updates = request.body;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates) ||
      Object.keys(updates).length === 0 || Object.hasOwn(updates, '_id')) {
    return response.status(400).json({ error: 'Provide lesson attributes to update; _id cannot be changed.' });
  }
  if (Object.hasOwn(updates, 'space') && (!Number.isInteger(updates.space) || updates.space < 0)) {
    return response.status(400).json({ error: 'Space must be a non-negative integer.' });
  }

  const result = await database.collection('lessons').updateOne(
    { _id: request.params.id },
    { $set: updates },
  );
  if (result.matchedCount === 0) return response.status(404).json({ error: 'Lesson not found.' });
  response.json(await database.collection('lessons').findOne({ _id: request.params.id }));
}));

app.get('/enrolment/:lessonid', handleRoute(async (request, response) => {
  const lessonExists = await database.collection('lessons').findOne(
    { _id: request.params.lessonid },
    { projection: { _id: 1 } },
  );
  if (!lessonExists) return response.status(404).json({ error: 'Lesson not found.' });

  const [result] = await database.collection('orders').aggregate([
    { $unwind: { path: '$items', preserveNullAndEmptyArrays: false } },
    { $match: { 'items.lessonId': request.params.lessonid } },
    { $group: { _id: null, enrolment: { $sum: '$items.quantity' } } },
  ]).toArray();
  response.json({ lessonId: request.params.lessonid, enrolment: result?.enrolment || 0 });
}));

app.use((request, response) => response.status(404).json({ error: 'Route not found.' }));
app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

const server = app.listen(port, () => console.log(`After-School API listening on port ${port}.`));

async function shutDown() {
  server.close(async () => {
    await mongoClient.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
