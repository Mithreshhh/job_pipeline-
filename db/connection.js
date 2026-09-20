/**
 * MongoDB connection.
 *
 * The connection string lives in the MONGO_URI environment variable, never
 * in this file - it contains a username and password, and anything written
 * here would end up in git history.
 *
 * Set it before running the pipeline, e.g.
 *   PowerShell:  $env:MONGO_URI = "mongodb+srv://user:pass@host/skeo"
 *   bash:        export MONGO_URI="mongodb+srv://user:pass@host/skeo"
 */

"use strict";

const mongoose = require("mongoose");

let connectionPromise = null;

/**
 * Opens the connection, or reuses it if one is already open. Mongoose keeps
 * a pool of sockets internally, so calling connect() repeatedly would waste
 * connections rather than speed anything up.
 */
function connectToMongo() {
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      "MONGO_URI is not set. Export your MongoDB connection string before running the pipeline."
    );
  }

  connectionPromise = mongoose.connect(uri);
  return connectionPromise;
}

async function disconnectFromMongo() {
  if (!connectionPromise) return;

  await mongoose.disconnect();
  connectionPromise = null;
}

module.exports = { connectToMongo, disconnectFromMongo };
