# Express.js App

Express REST API backed by MongoDB Atlas using the native Node.js `mongodb` driver. The server creates starter data in empty `lessons`, `teachers`, and `orders` collections. Existing non-empty collections are left untouched.

## Run locally

```powershell
Copy-Item .env.example .env
# Set MONGODB_URI to your Atlas connection string and optionally set DB_NAME.
npm install
npm start
```

The service listens on port `3000` by default. `npm run seed` seeds empty collections independently.

## API routes

| Method and route           | Purpose                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /lessons`             | Return all lessons and teacher display names as JSON. Optional `?teacherId=teacher-001` filters by teacher.          |
| `GET /search?q=art`        | Search topic, title, location, price, and available spaces on the server. Optional `teacherId` also filters results. |
| `GET /teachers`            | Return teacher names and their lesson IDs.                                                                           |
| `POST /orders`             | Save an order containing `name`, `phoneNumber`, `lessonIDs`, total `space`, and item quantities.                     |
| `PUT /lessons/:id`         | Set one or more attributes on a lesson, e.g. `{"space":4}` or `{"price":20}`.                                        |
| `GET /enrolment/:lessonid` | Return the number of purchased spaces for the lesson.                                                                |
| `GET /images/:filename`    | Serve files from `public/images`; missing images return a JSON 404.                                                  |

Every request is written to the server console with timestamp, method, URL, status code, and elapsed time.
